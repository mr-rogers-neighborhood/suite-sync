import { describe, expect, it } from "vitest";
import {
  coversVersionVector,
  decodeSyncMessage,
  diffVersionVector,
  encodeSyncMessage,
  isVersionVectorEmpty,
  mergeVersionVector,
  parseSyncMessage,
  type SyncMessage,
  versionVectorEquals,
} from "./sync.js";

const workspaceId = "a".repeat(64);
const memberId = "b".repeat(64);
const deviceId = "c".repeat(64);

describe("version vectors", () => {
  it("merges by taking the highest counter per peer", () => {
    expect(mergeVersionVector({ a: 1, b: 3 }, { a: 4, c: 2 })).toEqual({ a: 4, b: 3, c: 2 });
  });

  it("diffs to what the other side has not seen", () => {
    expect(diffVersionVector({ a: 5, b: 2 }, { a: 3, b: 2 })).toEqual({ a: 5 });
  });

  it("covers and equals", () => {
    expect(coversVersionVector({ a: 5, b: 2 }, { a: 3 })).toBe(true);
    expect(coversVersionVector({ a: 2 }, { a: 3 })).toBe(false);
    expect(versionVectorEquals({ a: 3 }, { a: 3, b: 0 })).toBe(true);
  });

  it("knows an empty vector", () => {
    expect(isVersionVectorEmpty({})).toBe(true);
    expect(isVersionVectorEmpty({ a: 0 })).toBe(false);
  });
});

describe("sync messages", () => {
  const messages: readonly SyncMessage[] = [
    {
      type: "hello",
      protocolVersion: 1,
      workspaceId,
      memberId,
      deviceId,
      epoch: 1,
      versionVector: { peer: 3 },
    },
    {
      type: "update",
      workspaceId,
      from: deviceId,
      to: "d".repeat(64),
      epoch: 1,
      payload: "AAEC",
    },
    { type: "ack", epoch: 1, versionVector: { peer: 4 } },
    { type: "error", code: "unauthorized", message: "Join refused" },
  ];

  it("round-trips every message shape", () => {
    for (const message of messages) {
      const decoded = decodeSyncMessage(encodeSyncMessage(message));
      expect(decoded).toEqual({ ok: true, value: message });
    }
  });

  it("reports every issue in a malformed message", () => {
    const parsed = parseSyncMessage({ type: "hello", workspaceId: "nope" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues.length).toBeGreaterThan(1);
  });

  it("refuses a message that is not JSON", () => {
    expect(decodeSyncMessage("{").ok).toBe(false);
  });

  it("refuses an unknown message type", () => {
    expect(parseSyncMessage({ type: "presence" }).ok).toBe(false);
  });
});
