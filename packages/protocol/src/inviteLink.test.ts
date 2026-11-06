import { describe, expect, it } from "vitest";
import { formatInvite, parseInvite } from "./inviteLink.js";

const details = {
  host: "ws://127.0.0.1:8787/sync",
  workspaceId: "a".repeat(64),
  inviteId: "b".repeat(64),
};

describe("an invitation travels as a link", () => {
  it("round-trips", () => {
    const parsed = parseInvite(formatInvite(details));
    expect(parsed).toEqual({ ok: true, value: details });
  });

  it("gets past the whitespace every chat client adds", () => {
    expect(parseInvite(`  ${formatInvite(details)}\n`)).toEqual({ ok: true, value: details });
  });
});

describe("a link that will not work says why", () => {
  it("asks for something at all", () => {
    expect(parseInvite("   ")).toEqual({ ok: false, reason: "Paste a link first." });
  });

  it("does not pretend to read a half-copied message", () => {
    expect(parseInvite("suite://join?h=ws://x")).toMatchObject({ ok: false });
  });

  it("refuses a link that is not an invitation", () => {
    expect(parseInvite("https://example.com/join")).toEqual({
      ok: false,
      reason: "That link is not an invitation to a workspace.",
    });
  });

  it("refuses one with no address", () => {
    expect(parseInvite(`suite://join?w=${"a".repeat(64)}&i=${"b".repeat(64)}`)).toEqual({
      ok: false,
      reason: "That invitation is missing the address to connect to.",
    });
  });

  it("refuses one with a truncated id", () => {
    expect(
      parseInvite(`suite://join?h=ws://127.0.0.1:8787/sync&w=abc&i=${"b".repeat(64)}`),
    ).toEqual({
      ok: false,
      reason: "That invitation is incomplete. Ask for a fresh one.",
    });
  });
});
