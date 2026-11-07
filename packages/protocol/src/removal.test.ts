import { describe, expect, it } from "vitest";
import {
  applyRemovalRecord,
  createRemovalState,
  isRemoved,
  type RemovalRecord,
  reinstateDevice,
  removalRecordPayload,
} from "./removal.js";

const workspaceId = "a".repeat(64);
const owner = "b".repeat(64);
const editor = "c".repeat(64);

/** A signature that is simply the payload: these tests are about rules, not about crypto. */
const sign = (payload: string) => `signed:${payload}`;
const verify = (payload: string, signature: string) => signature === sign(payload);

function record(overrides: Partial<RemovalRecord> = {}): RemovalRecord {
  const unsigned = {
    workspaceId,
    deviceId: editor,
    removedAt: "2026-11-06T12:00:00.000Z",
    signerId: owner,
  };
  const merged = { ...unsigned, ...overrides };
  return { ...merged, signature: sign(removalRecordPayload(merged)) };
}

const isOwner = (deviceId: string) => deviceId === owner;

describe("taking a device out", () => {
  it("applies an owner's record", () => {
    const state = createRemovalState(workspaceId);
    const applied = applyRemovalRecord(state, record(), verify, isOwner);

    expect(applied.ok && isRemoved(applied.state, editor)).toBe(true);
  });

  it("refuses a record signed by somebody who is not an owner", () => {
    // The signature is only as good as the permission behind it: an editor that signs its own
    // removal of somebody else is exactly what a role system exists to prevent.
    const applied = applyRemovalRecord(
      createRemovalState(workspaceId),
      record(),
      verify,
      () => false,
    );
    expect(applied).toEqual({ ok: false, reason: "not-owner" });
  });

  it("refuses an owner removing itself", () => {
    const applied = applyRemovalRecord(
      createRemovalState(workspaceId),
      record({ deviceId: owner }),
      verify,
      isOwner,
    );
    expect(applied).toEqual({ ok: false, reason: "self" });
  });

  it("refuses a record for another workspace", () => {
    const applied = applyRemovalRecord(
      createRemovalState(workspaceId),
      record({ workspaceId: "d".repeat(64) }),
      verify,
      isOwner,
    );
    expect(applied.ok).toBe(false);
  });

  it("refuses a record whose signature does not hold", () => {
    const tampered = { ...record(), removedAt: "2026-11-07T12:00:00.000Z" };
    const applied = applyRemovalRecord(createRemovalState(workspaceId), tampered, verify, isOwner);
    expect(applied).toEqual({ ok: false, reason: "invalid-signature" });
  });

  it("lets a device back in when an owner asks it back", () => {
    const state = createRemovalState(workspaceId);
    const removed = applyRemovalRecord(state, record(), verify, isOwner);
    if (!removed.ok) throw new Error("expected the record to apply");

    const back = reinstateDevice(removed.state, editor);
    expect(isRemoved(back, editor)).toBe(false);
    // A device that was never removed is left alone rather than copied.
    expect(reinstateDevice(back, editor)).toBe(back);
  });
});
