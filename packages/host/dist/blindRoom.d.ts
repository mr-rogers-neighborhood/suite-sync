import { type Frame, type FrameRejection, type RoleState, type SealedFrame } from "@suite/sync";
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
export type HostVerdict = {
    readonly ok: true;
    readonly frame: Frame;
} | {
    readonly ok: false;
    readonly reason: HostRejection;
};
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
export declare function admitFrame(sealed: SealedFrame, host: HostWorkspace, roles: RoleState, keyOf: (deviceId: string) => string | null, verify: FrameVerifier, receivedAt?: string): HostVerdict;
/**
 * The frames one workspace has, oldest first.
 *
 * Held in memory and persisted by whatever writes them out. The host may drop the oldest
 * when a retention window closes; it cannot compact them, because compaction is reading.
 */
export declare class FrameLog {
    readonly workspaceId: string;
    private readonly frames;
    constructor(workspaceId: string);
    get length(): number;
    /** The newest epoch stored, which is the one a later frame is measured against. */
    get newestEpoch(): number | null;
    append(frame: Frame): void;
    all(): readonly Frame[];
    /** Frames after the first `count`, which is how a returning device catches up. */
    since(count: number): readonly Frame[];
    /**
     * Forget frames that arrived before a cutoff.
     *
     * This is the retention window. A device away longer than this cannot replay its way
     * back in — it needs a snapshot from a peer, because the host cannot hand out a document
     * it was never able to read.
     */
    dropOlderThan(cutoff: string): number;
    /** Forget everything older than `epoch`. The host may not keep what it cannot read. */
    dropBefore(epoch: number): number;
}
//# sourceMappingURL=blindRoom.d.ts.map