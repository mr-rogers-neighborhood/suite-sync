import { LoroDoc } from "loro-crdt";
import { type VersionVector } from "../sync.js";
/**
 * The little a sync transport needs from a document.
 *
 * `LoroSyncPeer` is the Loro implementation. A test can use another one; the
 * protocol never imports Loro.
 */
export interface SyncPeer {
    readonly versionVector: VersionVector;
    exportSince(version: VersionVector): Uint8Array;
    applyUpdate(update: Uint8Array): void;
}
export interface SyncRound {
    readonly before: VersionVector;
    readonly after: VersionVector;
    readonly sentBytes: number;
    readonly receivedBytes: number;
}
/**
 * A Loro document behind the sync protocol.
 *
 * The first exchange sends each side the updates the other is missing. After
 * that, a transport can forward `subscribeUpdates` payloads directly; Loro
 * guarantees convergence as long as every peer receives every update.
 */
export declare class LoroSyncPeer implements SyncPeer {
    readonly doc: LoroDoc;
    constructor(doc?: LoroDoc);
    get versionVector(): VersionVector;
    exportSince(version: VersionVector): Uint8Array;
    applyUpdate(update: Uint8Array): void;
    /** Local updates as they happen, for a live transport to forward. */
    subscribeUpdates(listener: (update: Uint8Array) => void): () => void;
    /**
     * Exchange the missing updates with another peer.
     *
     * A round is enough in the common case. The loop exists because an update can
     * arrive with a dependency still missing; a second exchange lets the pending
     * operations resolve without the caller having to know.
     */
    syncWith(other: SyncPeer): SyncRound;
}
//# sourceMappingURL=loroPeer.d.ts.map