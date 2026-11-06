import {
  applyRoleRecord,
  createRoleState,
  type Frame,
  framePayload,
  type RoleState,
  type RoleVerifier,
} from "@suite/sync";
import { describe, expect, it } from "vitest";
import { admitFrame, FrameLog, type FrameVerifier } from "./blindRoom.js";

const workspaceId = "a".repeat(64);
const ownerDevice = "b".repeat(64);
const viewerDevice = "c".repeat(64);
const strangerDevice = "d".repeat(64);

const roleVerifier: RoleVerifier = (_payload, signature, signerId) =>
  signature === `signed-by-${signerId}`;

/** The device key check, stood in for: a signature names the device that made it. */
const frameVerifier: FrameVerifier = (_payload, signature, deviceId) =>
  signature === `signed-by-${deviceId}`;

function roles(): RoleState {
  const seeded = applyRoleRecord(
    createRoleState(workspaceId),
    {
      workspaceId,
      deviceId: ownerDevice,
      role: "owner",
      seq: 0,
      signerId: ownerDevice,
      signature: `signed-by-${ownerDevice}`,
    },
    roleVerifier,
  );
  if (!seeded.ok) throw new Error(seeded.reason);
  const withViewer = applyRoleRecord(
    seeded.state,
    {
      workspaceId,
      deviceId: viewerDevice,
      role: "viewer",
      seq: 0,
      signerId: ownerDevice,
      signature: `signed-by-${ownerDevice}`,
    },
    roleVerifier,
  );
  if (!withViewer.ok) throw new Error(withViewer.reason);
  return withViewer.state;
}

function frame(overrides: Partial<Frame> = {}): Frame {
  return {
    kind: "application",
    workspaceId,
    deviceId: ownerDevice,
    epoch: 1,
    payload: "AAAA",
    signature: `signed-by-${ownerDevice}`,
    receivedAt: "2026-11-06T12:00:00.000Z",
    ...overrides,
  };
}

const host = { workspaceId, newestEpoch: null };

describe("the four things a host may refuse", () => {
  it("stores a frame from an authorised device at the current epoch", () => {
    const verdict = admitFrame(frame(), host, roles(), frameVerifier);
    expect(verdict.ok).toBe(true);
  });

  it("refuses a frame for another workspace", () => {
    const verdict = admitFrame(
      frame({ workspaceId: "e".repeat(64) }),
      host,
      roles(),
      frameVerifier,
    );
    expect(verdict).toEqual({ ok: false, reason: "wrong-workspace" });
  });

  it("refuses an epoch it has already passed", () => {
    const verdict = admitFrame(
      frame({ epoch: 2 }),
      { workspaceId, newestEpoch: 5 },
      roles(),
      frameVerifier,
    );
    expect(verdict).toEqual({ ok: false, reason: "stale-epoch" });
  });

  it("refuses a device with no role record", () => {
    const verdict = admitFrame(
      frame({ deviceId: strangerDevice, signature: `signed-by-${strangerDevice}` }),
      host,
      roles(),
      frameVerifier,
    );
    expect(verdict).toEqual({ ok: false, reason: "not-authorized" });
  });

  it("refuses a viewer, before it looks at the signature", () => {
    const verdict = admitFrame(
      frame({ deviceId: viewerDevice, signature: `signed-by-${viewerDevice}` }),
      host,
      roles(),
      frameVerifier,
    );
    expect(verdict).toEqual({ ok: false, reason: "not-authorized" });
  });

  it("refuses a signature that does not verify", () => {
    const verdict = admitFrame(frame({ signature: "forged" }), host, roles(), frameVerifier);
    expect(verdict).toEqual({ ok: false, reason: "invalid-signature" });
  });
});

describe("the log the host keeps", () => {
  it("has no readable content in anything it stores", () => {
    const log = new FrameLog(workspaceId);
    // The payload a client seals is ciphertext; the host never sees the plaintext form,
    // so the log can hold every field a person would recognise and still hold nothing.
    log.append(frame({ payload: "q83vAAAA+Zg" }));
    log.append(frame({ epoch: 2, payload: "q83vAQAA+Zg" }));

    const stored = JSON.stringify(log.all());
    expect(stored).not.toContain("Q4 planning");
    expect(stored).toContain(workspaceId);
  });

  it("tracks the newest epoch so a later frame can be measured against it", () => {
    const log = new FrameLog(workspaceId);
    expect(log.newestEpoch).toBeNull();
    log.append(frame({ epoch: 3 }));
    log.append(frame({ epoch: 2 }));
    expect(log.newestEpoch).toBe(3);
  });

  it("hands a returning device only what it has not seen", () => {
    const log = new FrameLog(workspaceId);
    log.append(frame({ epoch: 1 }));
    log.append(frame({ epoch: 2 }));
    log.append(frame({ epoch: 3 }));
    expect(log.since(2)).toHaveLength(1);
    expect(log.since(0)).toHaveLength(3);
  });

  it("drops what a retention window closes", () => {
    const log = new FrameLog(workspaceId);
    log.append(frame({ epoch: 1 }));
    log.append(frame({ epoch: 2 }));
    log.append(frame({ epoch: 3 }));
    expect(log.dropBefore(3)).toBe(2);
    expect(log.all()).toHaveLength(1);
  });
});

describe("the signature covers the header, not only the payload", () => {
  it("changes when the epoch is rewritten", () => {
    const original = framePayload(frame());
    const rewritten = framePayload(frame({ epoch: 9 }));
    expect(Buffer.from(original).equals(Buffer.from(rewritten))).toBe(false);
  });

  it("changes when the sender is rewritten", () => {
    const original = framePayload(frame());
    const rewritten = framePayload(frame({ deviceId: viewerDevice }));
    expect(Buffer.from(original).equals(Buffer.from(rewritten))).toBe(false);
  });
});
