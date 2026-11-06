import {
  applyMembershipEntries,
  canWrite,
  type MemberRole,
  type MembershipEntry,
  type MembershipResult,
  type MembershipState,
  type MembershipVerifier,
  roleOf,
  type VersionVector,
} from "@suite/sync";
import { LoroSyncPeer } from "@suite/sync-client";

export type RoomRejection =
  | "not-member"
  | "member-inactive"
  | "epoch-mismatch"
  | "viewer-cannot-write"
  | "invalid-update";

export interface RoomJoin {
  readonly memberId: string;
  readonly deviceId: string;
  readonly epoch: number;
  readonly versionVector: VersionVector;
}

export type RoomJoinResult =
  | {
      readonly ok: true;
      readonly role: MemberRole;
      readonly epoch: number;
      readonly update: Uint8Array;
      readonly versionVector: VersionVector;
    }
  | { readonly ok: false; readonly reason: RoomRejection };

export type RoomApplyResult =
  | { readonly ok: true; readonly versionVector: VersionVector }
  | { readonly ok: false; readonly reason: RoomRejection };

/**
 * One workspace, one authoritative Loro replica for the server.
 *
 * The room is deliberately transport-free: the WebSocket layer feeds it bytes
 * and forwards the result. That keeps the authorization rules testable without a
 * socket, and lets a future folder transport reuse the same room.
 */
export class SyncRoom {
  readonly workspaceId: string;
  private readonly peer: LoroSyncPeer;
  private membership: MembershipState;

  constructor(workspaceId: string, membership: MembershipState) {
    this.workspaceId = workspaceId;
    this.membership = membership;
    this.peer = new LoroSyncPeer();
  }

  get epoch(): number {
    return this.membership.epoch;
  }

  get versionVector(): VersionVector {
    return this.peer.versionVector;
  }

  get members(): MembershipState {
    return this.membership;
  }

  /**
   * Authorize a join and return the updates the caller is missing.
   *
   * A join is refused when the member is not active or the epoch is stale. The
   * epoch check is what makes a revoke take effect even if the client still
   * holds a valid old key.
   */
  join(request: RoomJoin): RoomJoinResult {
    const role = roleOf(this.membership, request.memberId);
    if (role === null) return { ok: false, reason: "not-member" };
    if (request.epoch !== this.membership.epoch) {
      return { ok: false, reason: "epoch-mismatch" };
    }

    return {
      ok: true,
      role,
      epoch: this.membership.epoch,
      update: this.peer.exportSince(request.versionVector),
      versionVector: this.peer.versionVector,
    };
  }

  /** Apply one opaque Loro update from an authorized editor or owner. */
  applyFrom(memberId: string, update: Uint8Array): RoomApplyResult {
    const role = roleOf(this.membership, memberId);
    if (role === null) return { ok: false, reason: "not-member" };
    if (!canWrite(role)) return { ok: false, reason: "viewer-cannot-write" };

    try {
      this.peer.applyUpdate(update);
    } catch {
      return { ok: false, reason: "invalid-update" };
    }

    return { ok: true, versionVector: this.peer.versionVector };
  }

  /** The diff a reconnecting or late peer is missing. */
  updatesSince(version: VersionVector): Uint8Array {
    return this.peer.exportSince(version);
  }

  /**
   * Apply membership entries. A promotion or revocation is a normal log append;
   * the caller is responsible for disconnecting sockets that no longer fit the
   * new epoch or role.
   */
  applyMembership(
    entries: readonly MembershipEntry[],
    verify: MembershipVerifier,
    now?: string,
  ): MembershipResult {
    const result = applyMembershipEntries(this.membership, entries, verify, now);
    if (result.ok) this.membership = result.state;
    return result;
  }

  /** A full snapshot for a backup or a new peer with no history. */
  snapshot(): Uint8Array {
    return this.peer.doc.export({ mode: "snapshot" });
  }

  /** Load a snapshot saved by a previous process. */
  restore(snapshot: Uint8Array): void {
    this.peer.applyUpdate(snapshot);
  }
}
