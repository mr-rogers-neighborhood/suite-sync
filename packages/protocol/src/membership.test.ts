import { describe, expect, it } from "vitest";
import {
  applyMembershipEntries,
  applyMembershipEntry,
  createMembershipState,
  type MembershipAction,
  type MembershipEntry,
  type MembershipState,
  membershipEntryPayload,
  parseMembershipEntry,
} from "./membership.js";
import { canWrite } from "./roles.js";

const NOW = "2026-11-06T00:00:00.000Z";
const LATER = "2026-11-07T00:00:00.000Z";
const PAST = "2026-11-05T00:00:00.000Z";

const workspaceId = "a".repeat(64);
const ownerId = "b".repeat(64);
const editorId = "c".repeat(64);
const viewerId = "d".repeat(64);
const inviteId = "e".repeat(64);

type UnsignedEntry = Omit<MembershipEntry, "signature">;

function sign(entry: UnsignedEntry, key: string): MembershipEntry {
  return { ...entry, signature: `sig:${key}:${membershipEntryPayload(entry)}` };
}

function verify(entry: MembershipEntry, key: string): boolean {
  return entry.signature === `sig:${key}:${membershipEntryPayload(entry)}`;
}

function entry(
  seq: number,
  actorId: string,
  action: MembershipAction,
  createdAt = NOW,
): UnsignedEntry {
  return { seq, workspaceId, actorId, createdAt, action };
}

function createdState(): MembershipState {
  const create = sign(
    entry(1, ownerId, {
      type: "create",
      ownerPublicKey: "owner-key",
      displayName: "Owner",
    }),
    "owner-key",
  );
  const result = applyMembershipEntry(createMembershipState(workspaceId), create, verify, NOW);
  if (!result.ok) throw new Error(`create failed: ${result.reason}`);
  return result.state;
}

function invite(
  seq: number,
  memberId: string,
  role: "editor" | "viewer",
  expiresAt = LATER,
  id = inviteId,
): MembershipEntry {
  return sign(
    entry(seq, ownerId, {
      type: "invite",
      inviteId: id,
      memberId,
      publicKey: `${memberId}-key`,
      displayName: memberId === editorId ? "Editor" : "Viewer",
      role,
      expiresAt,
    }),
    "owner-key",
  );
}

function accept(seq: number, memberId: string, id = inviteId): MembershipEntry {
  return sign(entry(seq, memberId, { type: "accept", inviteId: id }), `${memberId}-key`);
}

function editorState(): MembershipState {
  const result = applyMembershipEntries(
    createdState(),
    [invite(2, editorId, "editor"), accept(3, editorId)],
    verify,
    NOW,
  );
  if (!result.ok) throw new Error(`invite failed: ${result.reason}`);
  return result.state;
}

describe("membership", () => {
  it("creates a workspace owner", () => {
    const state = createdState();
    expect(state.members[ownerId]?.role).toBe("owner");
    expect(state.members[ownerId]?.status).toBe("active");
    expect(state.lastSeq).toBe(1);
    expect(state.epoch).toBe(1);
  });

  it("invites and accepts an editor", () => {
    const state = editorState();
    expect(state.members[editorId]?.role).toBe("editor");
    expect(state.members[editorId]?.status).toBe("active");
    expect(canWrite(state.members[editorId]?.role ?? "viewer")).toBe(true);
    expect(state.invites[inviteId]?.status).toBe("accepted");
  });

  it("refuses an invite from an editor", () => {
    const state = editorState();
    const entryFromEditor = sign(
      entry(4, editorId, {
        type: "invite",
        inviteId: "f".repeat(64),
        memberId: viewerId,
        publicKey: `${viewerId}-key`,
        displayName: "Viewer",
        role: "viewer",
        expiresAt: LATER,
      }),
      `${editorId}-key`,
    );
    const result = applyMembershipEntry(state, entryFromEditor, verify, NOW);
    expect(result).toEqual({ ok: false, reason: "not-owner" });
  });

  it("sets a viewer role and refuses writes", () => {
    const state = editorState();
    const demote = sign(
      entry(4, ownerId, { type: "set-role", memberId: editorId, role: "viewer" }),
      "owner-key",
    );
    const result = applyMembershipEntry(state, demote, verify, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members[editorId]?.role).toBe("viewer");
    expect(canWrite(result.state.members[editorId]?.role ?? "viewer")).toBe(false);
  });

  it("bumps the epoch when a member is revoked and makes them inactive", () => {
    const state = editorState();
    const revoke = sign(entry(4, ownerId, { type: "revoke", memberId: editorId }), "owner-key");
    const result = applyMembershipEntry(state, revoke, verify, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.epoch).toBe(2);
    expect(result.state.members[editorId]?.status).toBe("revoked");
  });

  it("refuses to revoke the owner", () => {
    const state = createdState();
    const revoke = sign(entry(2, ownerId, { type: "revoke", memberId: ownerId }), "owner-key");
    const result = applyMembershipEntry(state, revoke, verify, NOW);
    expect(result).toEqual({ ok: false, reason: "self-revoke" });
  });

  it("refuses an expired invite", () => {
    const state = createdState();
    const expired = invite(2, editorId, "editor", PAST);
    const result = applyMembershipEntry(state, expired, verify, NOW);
    expect(result).toEqual({ ok: false, reason: "invite-expired" });
  });

  it("refuses a bad signature", () => {
    const state = createdState();
    const bad = sign(
      entry(2, ownerId, {
        type: "invite",
        inviteId,
        memberId: editorId,
        publicKey: `${editorId}-key`,
        displayName: "Editor",
        role: "editor",
        expiresAt: LATER,
      }),
      "not-the-owner-key",
    );
    const result = applyMembershipEntry(state, bad, verify, NOW);
    expect(result).toEqual({ ok: false, reason: "invalid-signature" });
  });

  it("refuses an out-of-order entry", () => {
    const state = createdState();
    const skipped = invite(5, editorId, "editor");
    const result = applyMembershipEntry(state, skipped, verify, NOW);
    expect(result).toEqual({ ok: false, reason: "wrong-seq" });
  });

  it("refuses a second create", () => {
    const state = createdState();
    const second = sign(
      entry(2, ownerId, {
        type: "create",
        ownerPublicKey: "other-key",
        displayName: "Another owner",
      }),
      "other-key",
    );
    const result = applyMembershipEntry(state, second, verify, NOW);
    expect(result).toEqual({ ok: false, reason: "already-initialised" });
  });

  it("refuses an entry from another workspace", () => {
    const state = createdState();
    const other = sign(
      {
        seq: 2,
        workspaceId: "f".repeat(64),
        actorId: ownerId,
        createdAt: NOW,
        action: { type: "revoke", memberId: editorId },
      },
      "owner-key",
    );
    const result = applyMembershipEntry(state, other, verify, NOW);
    expect(result).toEqual({ ok: false, reason: "wrong-workspace" });
  });

  it("refuses an invite accepted by someone else", () => {
    const state = createdState();
    const invited = invite(2, editorId, "editor");
    const wrongAccept = accept(3, viewerId);
    const result = applyMembershipEntries(state, [invited, wrongAccept], verify, NOW);
    expect(result).toEqual({ ok: false, reason: "invite-not-yours" });
  });

  it("refuses a role change that changes nothing", () => {
    const state = editorState();
    const same = sign(
      entry(4, ownerId, { type: "set-role", memberId: editorId, role: "editor" }),
      "owner-key",
    );
    const result = applyMembershipEntry(state, same, verify, NOW);
    expect(result).toEqual({ ok: false, reason: "role-unchanged" });
  });

  it("parses a valid entry and reports every issue in an invalid one", () => {
    const valid = invite(2, editorId, "editor");
    expect(parseMembershipEntry(valid).ok).toBe(true);

    const parsed = parseMembershipEntry({ ...valid, seq: -1, signature: "" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues.length).toBeGreaterThanOrEqual(2);
  });
});
