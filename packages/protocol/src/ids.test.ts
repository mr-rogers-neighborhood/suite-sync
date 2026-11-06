import { describe, expect, it } from "vitest";
import { isDeviceId, isInviteId, isMemberId, isWorkspaceId } from "./ids.js";

describe("ids", () => {
  const valid = "a".repeat(64);

  it("accepts a 64-character lower-case hex fingerprint", () => {
    expect(isWorkspaceId(valid)).toBe(true);
    expect(isDeviceId(valid)).toBe(true);
    expect(isMemberId(valid)).toBe(true);
    expect(isInviteId(valid)).toBe(true);
  });

  it("refuses the wrong length, upper case and non-hex characters", () => {
    expect(isWorkspaceId("a".repeat(63))).toBe(false);
    expect(isWorkspaceId("A".repeat(64))).toBe(false);
    expect(isWorkspaceId("g".repeat(64))).toBe(false);
    expect(isWorkspaceId(42)).toBe(false);
  });
});
