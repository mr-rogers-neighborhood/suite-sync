import { describe, expect, it } from "vitest";
import { addInvite, createInviteState, invitedRole, liveInvite, spendInvite } from "./invite.js";

const workspaceId = "a".repeat(64);
const inviteId = "b".repeat(64);
const owner = "c".repeat(64);
const now = new Date("2026-11-06T12:00:00.000Z");
const later = new Date("2026-11-06T13:00:00.000Z");

const verify = (payload: string, signature: string, signerId: string) =>
  signature === `signed-by-${signerId}` && payload.includes(inviteId);

function record(overrides: Partial<Parameters<typeof addInvite>[1]> = {}) {
  return {
    workspaceId,
    inviteId,
    role: "editor" as const,
    expiresAt: "2026-11-07T12:00:00.000Z",
    signerId: owner,
    signature: `signed-by-${owner}`,
    ...overrides,
  };
}

const ownerOf = (deviceId: string) => deviceId === owner;

describe("an invite is written by an owner", () => {
  it("is recorded and can be used", () => {
    const result = addInvite(createInviteState(workspaceId), record(), verify, ownerOf, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(liveInvite(result.state, inviteId, now)).toMatchObject({ ok: true });
  });

  it("is refused when somebody who is not an owner wrote it", () => {
    const result = addInvite(createInviteState(workspaceId), record(), verify, () => false, now);
    expect(result).toEqual({ ok: false, reason: "not-owner" });
  });

  it("is refused when the signature does not verify", () => {
    const result = addInvite(
      createInviteState(workspaceId),
      record({ signature: "forged" }),
      verify,
      ownerOf,
      now,
    );
    expect(result).toEqual({ ok: false, reason: "invalid-signature" });
  });

  it("is refused when it has already expired", () => {
    const result = addInvite(
      createInviteState(workspaceId),
      record({ expiresAt: "2026-11-06T11:00:00.000Z" }),
      verify,
      ownerOf,
      now,
    );
    expect(result).toEqual({ ok: false, reason: "expired" });
  });
});

describe("an invite is one device, once", () => {
  const seeded = () => {
    const result = addInvite(createInviteState(workspaceId), record(), verify, ownerOf, now);
    if (!result.ok) throw new Error(result.reason);
    return result.state;
  };

  it("stops working once it has been spent", () => {
    const spent = spendInvite(seeded(), inviteId);
    expect(liveInvite(spent, inviteId, now)).toEqual({ ok: false, reason: "invite-spent" });
  });

  it("stops working when it expires while a device is waiting", () => {
    // The window between a device asking and an owner answering is the one where this matters.
    expect(liveInvite(seeded(), inviteId, later)).toMatchObject({ ok: true });
    expect(liveInvite(seeded(), inviteId, new Date("2026-11-08T00:00:00.000Z"))).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("says nothing to a device presenting an id it never issued", () => {
    expect(liveInvite(seeded(), "d".repeat(64), now)).toEqual({
      ok: false,
      reason: "unknown-invite",
    });
  });
});

describe("the role an invite grants", () => {
  it("is what the owner chose, not what the device asked for", () => {
    const result = addInvite(
      createInviteState(workspaceId),
      record({ role: "viewer" }),
      verify,
      ownerOf,
      now,
    );
    if (!result.ok) throw new Error(result.reason);
    expect(invitedRole(result.state, inviteId)).toBe("viewer");
  });
});
