import { describe, expect, it } from "vitest";
import {
  applyRoleRecord,
  applyRoleRecords,
  createRoleState,
  mayWrite,
  ownerDevices,
  type RoleRecord,
  type RoleState,
  type RoleVerifier,
  roleOfDevice,
  roleRecordPayload,
} from "./roleRecord.js";

const workspaceId = "a".repeat(64);
const owner = "b".repeat(64);
const second = "c".repeat(64);
const third = "d".repeat(64);

/** Stands in for the device keys: a signature is whatever the test says it is. */
const verifier =
  (valid: readonly string[]): RoleVerifier =>
  (_payload, signature, signerId) =>
    valid.includes(`${signerId}:${signature}`);

function record(overrides: Partial<RoleRecord> = {}): RoleRecord {
  return {
    workspaceId,
    deviceId: owner,
    role: "owner",
    seq: 0,
    signerId: owner,
    signature: "ok",
    ...overrides,
  };
}

function owned(): RoleState {
  const applied = applyRoleRecord(
    createRoleState(workspaceId),
    record(),
    verifier([`${owner}:ok`]),
  );
  if (!applied.ok) throw new Error(applied.reason);
  return applied.state;
}

describe("the first record claims ownership", () => {
  it("lets a device make itself the owner of an empty workspace", () => {
    const state = owned();
    expect(roleOfDevice(state, owner)).toBe("owner");
    expect(ownerDevices(state)).toEqual([owner]);
  });

  it("refuses a first record that would make somebody else an owner", () => {
    const result = applyRoleRecord(
      createRoleState(workspaceId),
      record({ deviceId: second, role: "editor" }),
      verifier([`${owner}:ok`]),
    );
    expect(result).toEqual({ ok: false, reason: "not-owner" });
  });
});

describe("only an owner changes a role", () => {
  it("refuses a record signed by a non-owner", () => {
    const result = applyRoleRecord(
      owned(),
      record({ deviceId: third, role: "viewer", seq: 0, signerId: second, signature: "ok" }),
      verifier([`${second}:ok`]),
    );
    expect(result).toEqual({ ok: false, reason: "not-owner" });
  });

  it("accepts one signed by an owner", () => {
    const result = applyRoleRecord(
      owned(),
      record({ deviceId: second, role: "editor", seq: 0, signerId: owner, signature: "ok" }),
      verifier([`${owner}:ok`]),
    );
    expect(result.ok && roleOfDevice(result.state, second)).toBe("editor");
  });

  it("refuses a signature that does not verify", () => {
    const result = applyRoleRecord(
      owned(),
      record({ deviceId: second, role: "editor", seq: 0, signerId: owner, signature: "forged" }),
      verifier([`${owner}:ok`]),
    );
    expect(result).toEqual({ ok: false, reason: "invalid-signature" });
  });
});

describe("the chain is per device", () => {
  it("refuses a record that skips a sequence number", () => {
    const result = applyRoleRecord(
      owned(),
      record({ deviceId: second, role: "editor", seq: 4, signerId: owner, signature: "ok" }),
      verifier([`${owner}:ok`]),
    );
    expect(result).toEqual({ ok: false, reason: "wrong-seq" });
  });

  it("lets two devices be changed independently", () => {
    const first = applyRoleRecord(
      owned(),
      record({ deviceId: second, role: "editor", seq: 0, signerId: owner, signature: "ok" }),
      verifier([`${owner}:ok`]),
    );
    if (!first.ok) throw new Error(first.reason);
    const next = applyRoleRecord(
      first.state,
      record({ deviceId: third, role: "viewer", seq: 0, signerId: owner, signature: "ok" }),
      verifier([`${owner}:ok`]),
    );
    expect(next.ok && roleOfDevice(next.state, third)).toBe("viewer");
  });
});

describe("a workspace cannot be left without an owner", () => {
  it("refuses to demote the last owner", () => {
    const result = applyRoleRecord(
      owned(),
      record({ deviceId: owner, role: "editor", seq: 1, signerId: owner, signature: "ok" }),
      verifier([`${owner}:ok`]),
    );
    expect(result).toEqual({ ok: false, reason: "last-owner" });
  });

  it("allows it once a second owner exists", () => {
    const promoted = applyRoleRecord(
      owned(),
      record({ deviceId: second, role: "owner", seq: 0, signerId: owner, signature: "ok" }),
      verifier([`${owner}:ok`]),
    );
    if (!promoted.ok) throw new Error(promoted.reason);

    const demoted = applyRoleRecord(
      promoted.state,
      record({ deviceId: owner, role: "editor", seq: 1, signerId: owner, signature: "ok" }),
      verifier([`${owner}:ok`]),
    );
    expect(demoted.ok && ownerDevices(demoted.state)).toEqual([second]);
  });
});

describe("what the host asks before it stores a frame", () => {
  it("refuses a device with no role yet", () => {
    expect(mayWrite(owned(), third)).toBe(false);
  });

  it("refuses a viewer, and allows an editor", () => {
    const both = applyRoleRecords(
      owned(),
      [
        record({ deviceId: second, role: "viewer", seq: 0, signerId: owner, signature: "ok" }),
        record({ deviceId: third, role: "editor", seq: 0, signerId: owner, signature: "ok" }),
      ],
      verifier([`${owner}:ok`]),
    );
    if (!both.ok) throw new Error(both.reason);
    expect(mayWrite(both.state, second)).toBe(false);
    expect(mayWrite(both.state, third)).toBe(true);
  });

  it("refuses a viewer even though the record itself verified", () => {
    const state = applyRoleRecord(
      owned(),
      record({ deviceId: second, role: "viewer", seq: 0, signerId: owner, signature: "ok" }),
      verifier([`${owner}:ok`]),
    );
    if (!state.ok) throw new Error(state.reason);
    expect(roleOfDevice(state.state, second)).toBe("viewer");
    expect(mayWrite(state.state, second)).toBe(false);
  });
});

describe("the signed payload", () => {
  it("does not depend on the order the fields were built in", () => {
    const a = roleRecordPayload({
      workspaceId,
      deviceId: second,
      role: "editor",
      seq: 1,
      signerId: owner,
    });
    const b = roleRecordPayload({
      signerId: owner,
      seq: 1,
      role: "editor",
      deviceId: second,
      workspaceId,
    });
    expect(a).toBe(b);
  });

  it("excludes the signature, so it can be computed before signing", () => {
    expect(roleRecordPayload(record())).not.toContain("ok");
  });
});
