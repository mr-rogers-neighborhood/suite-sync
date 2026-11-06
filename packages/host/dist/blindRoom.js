import { framePayload, hostAcceptsEpoch, mayWrite, } from "@suite/sync";
/**
 * Decide whether to store one frame.
 *
 * The order matters: the workspace and the epoch are cheap and unambiguous, the role
 * record is next, and the signature is last because it is the most expensive. A frame
 * is only stored when all four agree.
 */
export function admitFrame(sealed, host, roles, keyOf, verify, receivedAt = new Date().toISOString()) {
    if (sealed.workspaceId !== host.workspaceId)
        return { ok: false, reason: "wrong-workspace" };
    if (!hostAcceptsEpoch(sealed.epoch, host.newestEpoch))
        return { ok: false, reason: "stale-epoch" };
    if (!mayWrite(roles, sealed.deviceId))
        return { ok: false, reason: "not-authorized" };
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
    workspaceId;
    frames = [];
    constructor(workspaceId) {
        this.workspaceId = workspaceId;
    }
    get length() {
        return this.frames.length;
    }
    /** The newest epoch stored, which is the one a later frame is measured against. */
    get newestEpoch() {
        let newest = null;
        for (const frame of this.frames) {
            if (newest === null || frame.epoch > newest)
                newest = frame.epoch;
        }
        return newest;
    }
    append(frame) {
        this.frames.push(frame);
    }
    all() {
        return this.frames;
    }
    /** Frames after the first `count`, which is how a returning device catches up. */
    since(count) {
        return this.frames.slice(Math.max(0, count));
    }
    /**
     * Forget frames that arrived before a cutoff.
     *
     * This is the retention window. A device away longer than this cannot replay its way
     * back in — it needs a snapshot from a peer, because the host cannot hand out a document
     * it was never able to read.
     */
    dropOlderThan(cutoff) {
        const kept = this.frames.filter((frame) => frame.receivedAt >= cutoff);
        const dropped = this.frames.length - kept.length;
        this.frames.length = 0;
        this.frames.push(...kept);
        return dropped;
    }
    /** Forget everything older than `epoch`. The host may not keep what it cannot read. */
    dropBefore(epoch) {
        const kept = this.frames.filter((frame) => frame.epoch >= epoch);
        const dropped = this.frames.length - kept.length;
        this.frames.length = 0;
        this.frames.push(...kept);
        return dropped;
    }
}
//# sourceMappingURL=blindRoom.js.map