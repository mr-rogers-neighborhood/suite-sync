import {
  type Frame,
  type FrameRejection,
  framePayload,
  hostAcceptsEpoch,
  mayWrite,
  type RoleState,
} from "@suite/sync";

/**
 * What a host is allowed to decide, and the only things it is allowed to decide.
 *
 * A blind host orders frames, stores them and hands them on. It cannot read one, cannot
 * merge two, and cannot tell whether the document inside is well formed. So its whole
 * authority is four refusals: the wrong workspace, an epoch it has already passed, a
 * sender with no role, and a signature that does not verify.
 *
 * Everything else is the clients' business. This module exists so those four refusals
 * are testable without a socket, and so the socket layer has nothing to decide.
 */
export type HostRejection = FrameRejection | "not-authorized" | "invalid-signature";

export type HostVerdict =
  | { readonly ok: true; readonly frame: Frame }
  | { readonly ok: false; readonly reason: HostRejection };

/** Verifies a frame's signature against the sending device's key. */
export type FrameVerifier = (payload: Uint8Array, signature: string, deviceId: string) => boolean;

export interface HostWorkspace {
  readonly workspaceId: string;
  /** The newest epoch this host has stored a frame for. */
  readonly newestEpoch: number | null;
}

/**
 * Decide whether to store one frame.
 *
 * The order matters: the workspace and the epoch are cheap and unambiguous, the role
 * record is next, and the signature is last because it is the most expensive. A frame
 * is only stored when all four agree.
 */
export function admitFrame(
  frame: Frame,
  host: HostWorkspace,
  roles: RoleState,
  verify: FrameVerifier,
): HostVerdict {
  if (frame.workspaceId !== host.workspaceId) return { ok: false, reason: "wrong-workspace" };

  if (!hostAcceptsEpoch(frame.epoch, host.newestEpoch)) return { ok: false, reason: "stale-epoch" };

  if (!mayWrite(roles, frame.deviceId)) return { ok: false, reason: "not-authorized" };

  if (!verify(framePayload(frame), frame.signature, frame.deviceId)) {
    return { ok: false, reason: "invalid-signature" };
  }

  return { ok: true, frame };
}

/**
 * The frames one workspace has, oldest first.
 *
 * Held in memory and persisted by whatever writes them out. The host may drop the oldest
 * when a retention window closes; it cannot compact them, because compaction is reading.
 */
export class FrameLog {
  readonly workspaceId: string;
  private readonly frames: Frame[] = [];

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }

  get length(): number {
    return this.frames.length;
  }

  /** The newest epoch stored, which is the one a later frame is measured against. */
  get newestEpoch(): number | null {
    let newest: number | null = null;
    for (const frame of this.frames) {
      if (newest === null || frame.epoch > newest) newest = frame.epoch;
    }
    return newest;
  }

  append(frame: Frame): void {
    this.frames.push(frame);
  }

  all(): readonly Frame[] {
    return this.frames;
  }

  /** Frames after the first `count`, which is how a returning device catches up. */
  since(count: number): readonly Frame[] {
    return this.frames.slice(Math.max(0, count));
  }

  /** Forget everything older than `epoch`. The host may not keep what it cannot read. */
  dropBefore(epoch: number): number {
    const kept = this.frames.filter((frame) => frame.epoch >= epoch);
    const dropped = this.frames.length - kept.length;
    this.frames.length = 0;
    this.frames.push(...kept);
    return dropped;
  }
}
