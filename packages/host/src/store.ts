import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type Frame,
  frameSchema,
  type InviteRecord,
  inviteRecordSchema,
  type MemberRole,
  memberRoleSchema,
  type RoleRecord,
  roleRecordSchema,
} from "@suite/sync";

/**
 * What a host keeps between process lifetimes: frames, and who may write.
 *
 * Frames are ciphertext and role records are signed public metadata — a device id and a
 * role, no content — so neither needs a key to sit on disk. The host reads the header of
 * a role record because it has to; it never reads a frame.
 *
 * Role records must be kept. A host that forgot them would refuse every frame after a
 * restart, which looks exactly like a broken workspace.
 */
export interface HostStore {
  loadFrames(workspaceId: string): Promise<readonly Frame[]>;
  appendFrame(workspaceId: string, frame: Frame): Promise<void>;
  loadRoles(workspaceId: string): Promise<readonly RoleRecord[]>;
  appendRole(workspaceId: string, record: RoleRecord): Promise<void>;
  /** Invites an owner wrote. They expire, so they are kept as records rather than as grants. */
  loadInvites(workspaceId: string): Promise<readonly InviteRecord[]>;
  appendInvite(workspaceId: string, record: InviteRecord): Promise<void>;
  /** The public key a device joined with, so its signature can be checked after a restart. */
  loadKeys(workspaceId: string): Promise<readonly PinnedKey[]>;
  appendKey(workspaceId: string, key: PinnedKey): Promise<void>;
  /** Forget frames that arrived before `cutoff`. A rewrite, so it runs when a window closes. */
  compact(workspaceId: string, cutoff: string): Promise<void>;
}

export interface PinnedKey {
  readonly deviceId: string;
  readonly publicKey: string;
  /** The name the device introduced itself with. */
  readonly name: string;
  /**
   * The invitation this device spent, if it spent one, and the role that invitation granted.
   *
   * Kept because the person adding the device may not have been connected when it asked, and
   * the invitation is spent the moment the key package lands. Without this a join that waited
   * for the owner would wait forever, and the honest answer to "why is it stuck" would be
   * "nobody remembers what it asked for".
   */
  readonly invitedWith?: { readonly inviteId: string; readonly role: MemberRole };
}

export class MemoryHostStore implements HostStore {
  private readonly frames = new Map<string, Frame[]>();
  private readonly invites = new Map<string, InviteRecord[]>();
  private readonly roles = new Map<string, RoleRecord[]>();
  private readonly keys = new Map<string, PinnedKey[]>();

  async loadFrames(workspaceId: string): Promise<readonly Frame[]> {
    return [...(this.frames.get(workspaceId) ?? [])];
  }

  async appendFrame(workspaceId: string, frame: Frame): Promise<void> {
    const existing = this.frames.get(workspaceId) ?? [];
    existing.push(frame);
    this.frames.set(workspaceId, existing);
  }

  async loadRoles(workspaceId: string): Promise<readonly RoleRecord[]> {
    return [...(this.roles.get(workspaceId) ?? [])];
  }

  async appendRole(workspaceId: string, record: RoleRecord): Promise<void> {
    const existing = this.roles.get(workspaceId) ?? [];
    existing.push(record);
    this.roles.set(workspaceId, existing);
  }

  async loadInvites(workspaceId: string): Promise<readonly InviteRecord[]> {
    return [...(this.invites.get(workspaceId) ?? [])];
  }

  async appendInvite(workspaceId: string, record: InviteRecord): Promise<void> {
    const existing = this.invites.get(workspaceId) ?? [];
    existing.push(record);
    this.invites.set(workspaceId, existing);
  }

  async loadKeys(workspaceId: string): Promise<readonly PinnedKey[]> {
    return [...(this.keys.get(workspaceId) ?? [])];
  }

  async appendKey(workspaceId: string, key: PinnedKey): Promise<void> {
    const existing = this.keys.get(workspaceId) ?? [];
    existing.push(key);
    this.keys.set(workspaceId, existing);
  }

  async compact(workspaceId: string, cutoff: string): Promise<void> {
    const kept = (this.frames.get(workspaceId) ?? []).filter((f) => f.receivedAt >= cutoff);
    this.frames.set(workspaceId, kept);
  }
}

/**
 * One append-only file per workspace, plus one for its roles.
 *
 * A crash mid-append can leave a partial line. That line is dropped on load rather than
 * failing the workspace: a torn write should cost one frame, not the room, because a frame
 * is only ever a message some device can still send again.
 */
export class FileHostStore implements HostStore {
  readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async loadFrames(workspaceId: string): Promise<readonly Frame[]> {
    return readLines(this.framePath(workspaceId), (value) => frameSchema.safeParse(value).data);
  }

  async appendFrame(workspaceId: string, frame: Frame): Promise<void> {
    await this.appendLine(this.framePath(workspaceId), frame);
  }

  async loadRoles(workspaceId: string): Promise<readonly RoleRecord[]> {
    return readLines(this.rolePath(workspaceId), (value) => roleRecordSchema.safeParse(value).data);
  }

  async appendRole(workspaceId: string, record: RoleRecord): Promise<void> {
    await this.appendLine(this.rolePath(workspaceId), record);
  }

  async loadInvites(workspaceId: string): Promise<readonly InviteRecord[]> {
    return readLines(
      this.invitePath(workspaceId),
      (value) => inviteRecordSchema.safeParse(value).data,
    );
  }

  async appendInvite(workspaceId: string, record: InviteRecord): Promise<void> {
    await this.appendLine(this.invitePath(workspaceId), record);
  }

  async loadKeys(workspaceId: string): Promise<readonly PinnedKey[]> {
    return readLines(this.keyPath(workspaceId), (value) => pinnedKey(value));
  }

  async appendKey(workspaceId: string, key: PinnedKey): Promise<void> {
    await this.appendLine(this.keyPath(workspaceId), key);
  }

  async compact(workspaceId: string, cutoff: string): Promise<void> {
    const kept = (await this.loadFrames(workspaceId)).filter((f) => f.receivedAt >= cutoff);
    await mkdir(this.directory, { recursive: true });
    const target = this.framePath(workspaceId);
    const temporary = `${target}.tmp`;
    await writeFile(temporary, kept.map((frame) => `${JSON.stringify(frame)}\n`).join(""), "utf8");
    await rename(temporary, target);
  }

  private async appendLine(path: string, value: unknown): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
  }

  private framePath(workspaceId: string): string {
    return join(this.directory, `${workspaceId}.frames.jsonl`);
  }

  private rolePath(workspaceId: string): string {
    return join(this.directory, `${workspaceId}.roles.jsonl`);
  }

  private invitePath(workspaceId: string): string {
    return join(this.directory, `${workspaceId}.invites.jsonl`);
  }

  private keyPath(workspaceId: string): string {
    return join(this.directory, `${workspaceId}.keys.jsonl`);
  }
}

async function readLines<T>(path: string, parse: (value: unknown) => T | undefined): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }

  const values: T[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    const parsed = parse(safeJson(line));
    if (parsed !== undefined) values.push(parsed);
  }
  return values;
}

function pinnedKey(value: unknown): PinnedKey | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.deviceId !== "string" || typeof record.publicKey !== "string") return undefined;
  const name = typeof record.name === "string" && record.name.length > 0 ? record.name : "a device";
  return {
    deviceId: record.deviceId,
    publicKey: record.publicKey,
    name,
    ...(invitedWith(record.invitedWith) ?? {}),
  };
}

/** The invitation a device spent, when the file still has one it can read. */
function invitedWith(value: unknown): Pick<PinnedKey, "invitedWith"> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const role = memberRoleSchema.safeParse(record.role);
  if (typeof record.inviteId !== "string" || !role.success) return undefined;
  return { invitedWith: { inviteId: record.inviteId, role: role.data } };
}

function safeJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
