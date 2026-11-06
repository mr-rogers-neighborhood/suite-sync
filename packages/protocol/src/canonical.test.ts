import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical.js";

describe("canonicalJson", () => {
  it("sorts object keys so insertion order cannot change the signed bytes", () => {
    const first = canonicalJson({ b: 2, a: 1, nested: { d: 4, c: 3 } });
    const second = canonicalJson({ nested: { c: 3, d: 4 }, a: 1, b: 2 });
    expect(first).toBe(second);
  });

  it("keeps array order, because order is data", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("drops undefined object entries rather than writing them", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});
