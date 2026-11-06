import {
  applyMembershipEntries,
  createMembershipState,
  type MembershipAction,
  type MembershipEntry,
  type MembershipState,
  membershipEntryPayload,
} from "@suite/sync";
import { LoroSyncPeer } from "@suite/sync/loro";
import { describe, expect, it } from "vitest";
import { SyncRoom } from "./room.js";

const NOW = "2026-11-06T00:00:00.000Z";
const LATER = "2026-11-07T00:00:00.000Z";

const workspaceId = "a".repeat(64);
const ownerId = "b".repeat(64);
const editorId = "c".repeat(64);
const viewerId = "d".repeat(64);
const editorInvite = "e".repeat(64);
const viewerInvite = "f".repeat(64);

type UnsignedEntry = Omit<MembershipEntry, "signature">;

function sign(entry: UnsignedEntry, key: string): MembershipEntry {
  return { ...entry, signature: `sig:${key}:${membershipEntryPayload(entry)}` };
}

function verify(entry: MembershipEntry, key: string): boolean {
  return entry.signature === `sig:${key}:${membershipEntryPayload(entry)}`;
}

function entry(seq: number, actorId: string, action: MembershipAction): UnsignedEntry {
  return { seq, workspaceId, actorId, createdAt: NOW, action };
}

function seed(): MembershipState {
  const entries: MembershipEntry[] = [
    sign(
      entry(1, ownerId, {
        type: "create",
        ownerPublicKey: "owner-key",
        displayName: "Owner",
      }),
      "owner-key",
    ),
    sign(
      entry(2, ownerId, {
        type: "invite",
        inviteId: editorInvite,
        memberId: editorId,
        publicKey: `${editorId}-key`,
        displayName: "Editor",
        role: "editor",
        expiresAt: LATER,
      }),
      "owner-key",
    ),
    sign(entry(3, editorId, { type: "accept", inviteId: editorInvite }), `${editorId}-key`),
    sign(
      entry(4, ownerId, {
        type: "invite",
        inviteId: viewerInvite,
        memberId: viewerId,
        publicKey: `${viewerId}-key`,
        displayName: "Viewer",
        role: "viewer",
        expiresAt: LATER,
      }),
      "owner-key",
    ),
    sign(entry(5, viewerId, { type: "accept", inviteId: viewerInvite }), `${viewerId}-key`),
  ];

  const result = applyMembershipEntries(createMembershipState(workspaceId), entries, verify, NOW);
  if (!result.ok) throw new Error(`seed failed: ${result.reason}`);
  return result.state;
}

function room(): SyncRoom {
  return new SyncRoom(workspaceId, seed());
}

function edit(peer: LoroSyncPeer, key: string, value: number): Uint8Array {
  peer.doc.getMap("root").set(key, value);
  peer.doc.commit();
  return peer.exportSince({});
}

describe("SyncRoom", () => {
  it("lets an editor write and hands the update to a joining peer", () => {
    const server = room();
    const editor = new LoroSyncPeer();

    const applied = server.applyFrom(editorId, edit(editor, "card", 1));
    expect(applied.ok).toBe(true);

    const joined = server.join({
      memberId: viewerId,
      deviceId: viewerId,
      epoch: server.epoch,
      versionVector: {},
    });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;

    const viewer = new LoroSyncPeer();
    viewer.applyUpdate(joined.update);
    expect(viewer.doc.getMap("root").get("card")).toBe(1);
  });

  it("refuses a viewer write", () => {
    const server = room();
    const viewer = new LoroSyncPeer();

    const applied = server.applyFrom(viewerId, edit(viewer, "card", 1));
    expect(applied).toEqual({ ok: false, reason: "viewer-cannot-write" });
  });

  it("refuses an unknown member", () => {
    const server = room();
    expect(
      server.join({
        memberId: "9".repeat(64),
        deviceId: "9".repeat(64),
        epoch: server.epoch,
        versionVector: {},
      }),
    ).toEqual({ ok: false, reason: "not-member" });
  });

  it("refuses a stale epoch", () => {
    const server = room();
    expect(
      server.join({
        memberId: editorId,
        deviceId: editorId,
        epoch: server.epoch + 1,
        versionVector: {},
      }),
    ).toEqual({ ok: false, reason: "epoch-mismatch" });
  });

  it("refuses a revoked member after the epoch rotates", () => {
    const server = room();
    const revoke = sign(entry(6, ownerId, { type: "revoke", memberId: editorId }), "owner-key");
    const result = server.applyMembership([revoke], verify, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.epoch).toBe(2);
    expect(server.epoch).toBe(2);
    expect(
      server.join({
        memberId: editorId,
        deviceId: editorId,
        epoch: server.epoch,
        versionVector: {},
      }),
    ).toEqual({ ok: false, reason: "not-member" });
    expect(server.applyFrom(editorId, new Uint8Array())).toEqual({
      ok: false,
      reason: "not-member",
    });
  });

  it("refuses bytes that are not a Loro update", () => {
    const server = room();
    expect(server.applyFrom(editorId, Uint8Array.from([1, 2, 3]))).toEqual({
      ok: false,
      reason: "invalid-update",
    });
  });

  it("returns a snapshot the server can restore from", () => {
    const server = room();
    server.applyFrom(editorId, edit(new LoroSyncPeer(), "card", 7));
    const snapshot = server.snapshot();
    expect(snapshot.length).toBeGreaterThan(0);
  });
});
