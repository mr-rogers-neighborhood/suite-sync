import { LoroDoc, VersionVector as LoroVersionVector } from "loro-crdt";
import { coversVersionVector, diffVersionVector, isVersionVectorEmpty, } from "../sync.js";
/**
 * A Loro document behind the sync protocol.
 *
 * The first exchange sends each side the updates the other is missing. After
 * that, a transport can forward `subscribeUpdates` payloads directly; Loro
 * guarantees convergence as long as every peer receives every update.
 */
export class LoroSyncPeer {
    doc;
    constructor(doc = new LoroDoc()) {
        this.doc = doc;
    }
    get versionVector() {
        return fromLoroVersion(this.doc.version());
    }
    exportSince(version) {
        // Loro emits a small header even when there is nothing to send. Asking the
        // version vectors first keeps an empty exchange truly empty.
        if (isVersionVectorEmpty(diffVersionVector(this.versionVector, version))) {
            return new Uint8Array();
        }
        return this.doc.export({ mode: "update", from: toLoroVersion(version) });
    }
    applyUpdate(update) {
        this.doc.import(update);
    }
    /** Local updates as they happen, for a live transport to forward. */
    subscribeUpdates(listener) {
        return this.doc.subscribeLocalUpdates(listener);
    }
    /**
     * Exchange the missing updates with another peer.
     *
     * A round is enough in the common case. The loop exists because an update can
     * arrive with a dependency still missing; a second exchange lets the pending
     * operations resolve without the caller having to know.
     */
    syncWith(other) {
        const before = this.versionVector;
        let sentBytes = 0;
        let receivedBytes = 0;
        for (let round = 0; round < 3; round += 1) {
            const mine = this.versionVector;
            const theirs = other.versionVector;
            if (coversVersionVector(mine, theirs) && coversVersionVector(theirs, mine))
                break;
            const toThem = this.exportSince(theirs);
            const toMe = other.exportSince(mine);
            if (toMe.length > 0)
                this.applyUpdate(toMe);
            if (toThem.length > 0)
                other.applyUpdate(toThem);
            sentBytes += toThem.length;
            receivedBytes += toMe.length;
            if (toMe.length === 0 && toThem.length === 0)
                break;
        }
        return { before, after: this.versionVector, sentBytes, receivedBytes };
    }
}
function fromLoroVersion(version) {
    const record = {};
    for (const [peer, counter] of version.toJSON())
        record[peer] = counter;
    return record;
}
function toLoroVersion(version) {
    const entries = Object.entries(version).map(([peer, counter]) => [peer, counter]);
    return new LoroVersionVector(new Map(entries));
}
//# sourceMappingURL=loroPeer.js.map