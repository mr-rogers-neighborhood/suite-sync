import { describe, expect, it } from "vitest";
import { DEFAULT_HOST, DEFAULT_PORT, formatStatus, parseServeOptions, runCli } from "./cli.js";

describe("arguments", () => {
  it("defaults to loopback and refuses to check signatures it cannot check", () => {
    const parsed = parseServeOptions([]);
    expect(parsed.ok && parsed.value).toEqual({
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      store: ".suite-sync",
      trustAll: false,
    });
  });

  it("takes a host, a port and a store", () => {
    const parsed = parseServeOptions(["--host", "0.0.0.0", "--port", "9000", "--store", "/tmp/x"]);
    expect(parsed.ok && parsed.value.host).toBe("0.0.0.0");
    expect(parsed.ok && parsed.value.port).toBe(9000);
    expect(parsed.ok && parsed.value.store).toBe("/tmp/x");
  });

  it("refuses a port that is not one", () => {
    expect(parseServeOptions(["--port", "eighty"])).toEqual({
      ok: false,
      error: "not a port: eighty",
    });
  });

  it("refuses an argument it does not know, rather than ignoring it", () => {
    expect(parseServeOptions(["--workspace", "x"])).toEqual({
      ok: false,
      error: "unknown argument: --workspace",
    });
  });
});

describe("the command line", () => {
  it("prints its version", async () => {
    const result = await runCli(["--version"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("suite-sync");
  });

  it("refuses to serve without device keys, and says why", async () => {
    const result = await runCli(["serve"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("no device keys");
  });

  it("reports what a serve would do", async () => {
    const result = await runCli(["status", "--trust-all"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("not checked");
  });

  it("says so when the command is not one it has", async () => {
    const result = await runCli(["frobnicate"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("unknown command: frobnicate");
  });
});

describe("the status line", () => {
  it("names every choice that changes behaviour", () => {
    const text = formatStatus({
      host: "127.0.0.1",
      port: 8787,
      store: ".suite-sync",
      trustAll: true,
    });
    expect(text).toContain("127.0.0.1:8787");
    expect(text).toContain(".suite-sync");
    expect(text).toContain("not checked");
  });
});
