import {
  type Frame,
  type FrameKind,
  type FrameRejection,
  framePayload,
  hostAcceptsEpoch,
  mayWrite,
  type RoleState,
  type SealedFrame,
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
export type HostRejection = FrameRejection;

export type HostVerdict =
  | { readonly ok: true; readonly frame: Frame }
  | { readonly ok: false; readonly reason: HostRejection };

/** Verifies a frame's signature against a public key the host pinned for that device. */
export type FrameVerifier = (payload: Uint8Array, signature: string, publicKey: string) => boolean;

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
export interface AdmitOptions {
  /**
   * A frame kind that may come from a device with no role.
   *
   * There is exactly one caller: a key package, which is how a device asks to join. A live
   * invite is what makes it safe, and the invite is checked before this is reached.
   */
  readonly kindAllowedWithoutRole?: FrameKind;
}

export function admitFrame(
  sealed: SealedFrame,
  host: HostWorkspace,
  roles: RoleState,
  keyOf: (deviceId: string) => string | null,
  verify: FrameVerifier,
  receivedAt: string = new Date().toISOString(),
  admitOptions: AdmitOptions = {},
): HostVerdict {
  if (sealed.workspaceId !== host.workspaceId) return { ok: false, reason: "wrong-workspace" };

  if (!hostAcceptsEpoch(sealed.epoch, host.newestEpoch))
    return { ok: false, reason: "stale-epoch" };

  const invited = admitOptions.kindAllowedWithoutRole === sealed.kind;
  if (!invited && !mayWrite(roles, sealed.deviceId)) return { ok: false, reason: "not-authorized" };

  const publicKey = keyOf(sealed.deviceId);
  if (publicKey === null || !verify(framePayload(sealed), sealed.signature, publicKey)) {
    return { ok: false, reason: "invalid-signature" };
  }

  return { ok: true, frame: { ...sealed, receivedAt } };
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

  /**
   * Forget frames that arrived before a cutoff.
   *
   * This is the retention window. A device away longer than this cannot replay its way
   * back in — it needs a snapshot from a peer, because the host cannot hand out a document
   * it was never able to read.
   */
  dropOlderThan(cutoff: string): number {
    const kept = this.frames.filter((frame) => frame.receivedAt >= cutoff);
    const dropped = this.frames.length - kept.length;
    this.frames.length = 0;
    this.frames.push(...kept);
    return dropped;
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
