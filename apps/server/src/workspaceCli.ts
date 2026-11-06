import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import {
  decodeBase64,
  isMemberId,
  isWorkspaceId,
  type MemberRole,
  type MembershipState,
  parseMembershipState,
} from "@suite/sync";
import { LoroSyncPeer } from "@suite/sync/loro";
import { workspaceFiles } from "./workspace.js";

export interface WorkspaceMemberSummary {
  readonly memberId: string;
  readonly displayName: string;
  readonly role: MemberRole;
}

export interface WorkspaceSummary {
  readonly workspaceId: string;
  readonly epoch: number;
  readonly members: readonly WorkspaceMemberSummary[];
}

export interface WorkspaceInitOptions {
  readonly directory: string;
  readonly fromCanvas?: string;
  readonly workspaceId?: string;
  readonly ownerId?: string;
  readonly editorId?: string;
  readonly force?: boolean;
}

export interface AddMemberOptions {
  readonly memberId: string;
  readonly role: MemberRole;
  readonly displayName: string;
}

const NOW = "2026-11-06T00:00:00.000Z";

/**
 * Create a Phase 2 workspace directory from a `.canvas` file or from scratch.
 *
 * The membership state is the admin shape for this phase; the signed log and
 * the invite/accept flow replace it. The `.canvas` reader only needs the two
 * envelope fields this phase relies on: the workspace id and the snapshot.
 */
export async function initWorkspace(options: WorkspaceInitOptions): Promise<WorkspaceSummary> {
  const files = workspaceFiles(options.directory);
  if (!options.force && (await fileExists(files.membership))) {
    throw new Error(`${files.membership} already exists; pass --force to replace it`);
  }

  const canvas = options.fromCanvas === undefined ? null : await readCanvas(options.fromCanvas);
  const workspaceId =
    options.workspaceId ?? (canvas === null ? randomId() : syncIdFor(canvas.workspaceId));

  if (!isWorkspaceId(workspaceId)) {
    throw new Error("workspace id must be 64 lower-case hex characters");
  }

  const ownerId = options.ownerId ?? randomId();
  const editorId = options.editorId ?? randomId();
  if (!isMemberId(ownerId) || !isMemberId(editorId)) {
    throw new Error("member ids must be 64 lower-case hex characters");
  }
  if (ownerId === editorId) {
    throw new Error("owner and editor must be different members");
  }

  const state: MembershipState = {
    workspaceId,
    epoch: 1,
    lastSeq: 0,
    members: {
      [ownerId]: {
        memberId: ownerId,
        displayName: "Owner",
        publicKey: `${ownerId}-key`,
        role: "owner",
        status: "active",
        joinedAt: NOW,
        epoch: 1,
      },
      [editorId]: {
        memberId: editorId,
        displayName: "Editor",
        publicKey: `${editorId}-key`,
        role: "editor",
        status: "active",
        joinedAt: NOW,
        epoch: 1,
      },
    },
    invites: {},
  };

  await mkdir(options.directory, { recursive: true });
  await writeJsonAtomic(files.membership, state);

  const snapshot =
    canvas === null
      ? new LoroSyncPeer().doc.export({ mode: "snapshot" })
      : decodeSnapshot(canvas.document, options.fromCanvas ?? "canvas");
  await writeFile(files.snapshot, snapshot);

  return summarize(state);
}

export async function showWorkspace(directory: string): Promise<WorkspaceSummary> {
  return summarize(await readMembership(directory));
}

export async function addWorkspaceMember(
  directory: string,
  options: AddMemberOptions,
): Promise<WorkspaceSummary> {
  if (!isMemberId(options.memberId)) {
    throw new Error("member id must be 64 lower-case hex characters");
  }

  const state = await readMembership(directory);
  const existing = state.members[options.memberId];
  if (existing?.status === "active") {
    throw new Error("that member is already active");
  }

  const member = {
    memberId: options.memberId,
    displayName: options.displayName,
    publicKey: `${options.memberId}-key`,
    role: options.role,
    status: "active" as const,
    joinedAt: NOW,
    epoch: state.epoch,
  };

  const next: MembershipState = {
    ...state,
    members: { ...state.members, [member.memberId]: member },
  };
  await writeJsonAtomic(workspaceFiles(directory).membership, next);
  return summarize(next);
}

export function summarize(state: MembershipState): WorkspaceSummary {
  return {
    workspaceId: state.workspaceId,
    epoch: state.epoch,
    members: Object.values(state.members)
      .filter((member) => member.status === "active")
      .map((member) => ({
        memberId: member.memberId,
        displayName: member.displayName,
        role: member.role,
      })),
  };
}

export function formatWorkspaceSummary(summary: WorkspaceSummary): string {
  const lines = [`workspace ${summary.workspaceId}`, `epoch     ${summary.epoch}`, "members:"];
  for (const member of summary.members) {
    lines.push(`  ${member.role.padEnd(6)} ${member.displayName.padEnd(12)} ${member.memberId}`);
  }
  return `${lines.join("\n")}\n`;
}

async function readMembership(directory: string): Promise<MembershipState> {
  const files = workspaceFiles(directory);
  const text = await readFile(files.membership, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${files.membership}: not JSON`);
  }
  const parsed = parseMembershipState(value);
  if (!parsed.ok) throw new Error(`${files.membership}: ${parsed.issues.join("; ")}`);
  return parsed.value;
}

interface CanvasEnvelope {
  readonly workspaceId: string;
  readonly document: string;
}

async function readCanvas(path: string): Promise<CanvasEnvelope> {
  const text = await readFile(path, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${path}: not JSON`);
  }
  if (typeof value !== "object" || value === null) throw new Error(`${path}: not a canvas file`);
  const record = value as Record<string, unknown>;
  if (typeof record.workspaceId !== "string" || record.workspaceId.length === 0) {
    throw new Error(`${path}: no workspaceId`);
  }
  if (typeof record.document !== "string" || record.document.length === 0) {
    throw new Error(`${path}: no document snapshot`);
  }
  return { workspaceId: record.workspaceId, document: record.document };
}

function decodeSnapshot(value: string, path: string): Uint8Array {
  const bytes = decodeBase64(value);
  if (bytes === null) throw new Error(`${path}: document is not base64`);
  return bytes;
}

/** 64 hex for the sync room; a non-hex app id is hashed to one. */
export function syncIdFor(appWorkspaceId: string): string {
  if (isWorkspaceId(appWorkspaceId)) return appWorkspaceId;
  return createHash("sha256").update(appWorkspaceId).digest("hex");
}

function randomId(): string {
  return randomBytes(32).toString("hex");
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}
