import {
  coversVersionVector,
  diffVersionVector,
  isVersionVectorEmpty,
  type VersionVector,
} from "@suite/sync";
import { LoroDoc, VersionVector as LoroVersionVector } from "loro-crdt";

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
export class LoroSyncPeer implements SyncPeer {
  readonly doc: LoroDoc;

  constructor(doc: LoroDoc = new LoroDoc()) {
    this.doc = doc;
  }

  get versionVector(): VersionVector {
    return fromLoroVersion(this.doc.version());
  }

  exportSince(version: VersionVector): Uint8Array {
    // Loro emits a small header even when there is nothing to send. Asking the
    // version vectors first keeps an empty exchange truly empty.
    if (isVersionVectorEmpty(diffVersionVector(this.versionVector, version))) {
      return new Uint8Array();
    }
    return this.doc.export({ mode: "update", from: toLoroVersion(version) });
  }

  applyUpdate(update: Uint8Array): void {
    this.doc.import(update);
  }

  /** Local updates as they happen, for a live transport to forward. */
  subscribeUpdates(listener: (update: Uint8Array) => void): () => void {
    return this.doc.subscribeLocalUpdates(listener);
  }

  /**
   * Exchange the missing updates with another peer.
   *
   * A round is enough in the common case. The loop exists because an update can
   * arrive with a dependency still missing; a second exchange lets the pending
   * operations resolve without the caller having to know.
   */
  syncWith(other: SyncPeer): SyncRound {
    const before = this.versionVector;
    let sentBytes = 0;
    let receivedBytes = 0;

    for (let round = 0; round < 3; round += 1) {
      const mine = this.versionVector;
      const theirs = other.versionVector;
      if (coversVersionVector(mine, theirs) && coversVersionVector(theirs, mine)) break;

      const toThem = this.exportSince(theirs);
      const toMe = other.exportSince(mine);

      if (toMe.length > 0) this.applyUpdate(toMe);
      if (toThem.length > 0) other.applyUpdate(toThem);

      sentBytes += toThem.length;
      receivedBytes += toMe.length;

      if (toMe.length === 0 && toThem.length === 0) break;
    }

    return { before, after: this.versionVector, sentBytes, receivedBytes };
  }
}

function fromLoroVersion(version: LoroVersionVector): VersionVector {
  const record: VersionVector = {};
  for (const [peer, counter] of version.toJSON()) record[peer] = counter;
  return record;
}

function toLoroVersion(version: VersionVector): LoroVersionVector {
  const entries = Object.entries(version).map(
    ([peer, counter]) => [peer as `${number}`, counter] as const,
  );
  return new LoroVersionVector(new Map(entries));
}
