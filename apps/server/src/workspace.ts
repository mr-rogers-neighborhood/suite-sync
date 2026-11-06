import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseMembershipState } from "@suite/sync";
import { SyncRoom } from "./room.js";

/**
 * A Phase 2 workspace directory:
 *
 * ```
 * <dir>/membership.json   the serialized membership state
 * <dir>/snapshot.loro     an optional full Loro snapshot
 * ```
 *
 * The membership state is trusted admin input for now. The signed log and the
 * invite/accept flow replace it; until then, the operator is the owner and the
 * file is written by the app or by an explicit admin command.
 */
export interface WorkspaceFiles {
  readonly membership: string;
  readonly snapshot: string;
}

export const WORKSPACE_MEMBERSHIP_FILE = "membership.json";
export const WORKSPACE_SNAPSHOT_FILE = "snapshot.loro";

export function workspaceFiles(directory: string): WorkspaceFiles {
  return {
    membership: join(directory, WORKSPACE_MEMBERSHIP_FILE),
    snapshot: join(directory, WORKSPACE_SNAPSHOT_FILE),
  };
}

export async function loadWorkspace(directory: string): Promise<SyncRoom> {
  const files = workspaceFiles(directory);
  const text = await readFile(files.membership, "utf8");

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${files.membership}: not JSON`);
  }

  const parsed = parseMembershipState(value);
  if (!parsed.ok) {
    throw new Error(`${files.membership}: ${parsed.issues.join("; ")}`);
  }

  const room = new SyncRoom(parsed.value.workspaceId, parsed.value);
  const snapshot = await readOptional(files.snapshot);
  if (snapshot !== null) room.restore(snapshot);
  return room;
}

async function readOptional(path: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(path));
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
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
