import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Where a room's bytes live between process lifetimes.
 *
 * The store is deliberately dumb: it saves and loads an opaque snapshot. The
 * encryption layer will sit above it, so a file-backed store never needs to
 * know what a document contains.
 */
export interface RoomStore {
  load(workspaceId: string): Promise<Uint8Array | null>;
  save(workspaceId: string, snapshot: Uint8Array): Promise<void>;
}

export class MemoryRoomStore implements RoomStore {
  private readonly snapshots = new Map<string, Uint8Array>();

  async load(workspaceId: string): Promise<Uint8Array | null> {
    return this.snapshots.get(workspaceId) ?? null;
  }

  async save(workspaceId: string, snapshot: Uint8Array): Promise<void> {
    this.snapshots.set(workspaceId, Uint8Array.from(snapshot));
  }
}

/**
 * One file per workspace, written to a temporary name and renamed into place.
 *
 * A crash mid-write leaves the previous snapshot intact. A real deployment adds
 * `fsync` and a directory sync; this is the same shape `@suite/files/node` uses
 * for the app documents.
 */
export class FileRoomStore implements RoomStore {
  readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async load(workspaceId: string): Promise<Uint8Array | null> {
    try {
      const bytes = await readFile(this.pathFor(workspaceId));
      return new Uint8Array(bytes);
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  async save(workspaceId: string, snapshot: Uint8Array): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.pathFor(workspaceId);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, snapshot);
    await rename(temporary, target);
  }

  private pathFor(workspaceId: string): string {
    return join(this.directory, `${workspaceId}.snapshot`);
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
