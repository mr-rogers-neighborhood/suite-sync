import { describe, expect, it } from "vitest";
import { decodeBase64, encodeBase64 } from "./base64.js";

describe("base64", () => {
  it("encodes and decodes every byte value", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    const encoded = encodeBase64(bytes);
    const decoded = decodeBase64(encoded);
    expect(decoded).not.toBeNull();
    expect(Array.from(decoded ?? [])).toEqual(Array.from(bytes));
  });

  it("handles the three padding cases", () => {
    expect(encodeBase64(Uint8Array.from([0x66]))).toBe("Zg==");
    expect(encodeBase64(Uint8Array.from([0x66, 0x6f]))).toBe("Zm8=");
    expect(encodeBase64(Uint8Array.from([0x66, 0x6f, 0x6f]))).toBe("Zm9v");
  });

  it("round-trips an empty payload", () => {
    expect(encodeBase64(new Uint8Array())).toBe("");
    expect(decodeBase64("")).toEqual(new Uint8Array());
  });

  it("refuses a character outside the alphabet", () => {
    expect(decodeBase64("not base64!")).toBeNull();
  });
});
