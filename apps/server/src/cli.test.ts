import { describe, expect, it } from "vitest";
import { DEFAULT_HOST, DEFAULT_PORT, parseServeOptions, runCli, SERVER_VERSION } from "./cli.js";

describe("suite-sync CLI", () => {
  it("prints the server and protocol versions", () => {
    const result = runCli(["--version"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(SERVER_VERSION);
    expect(result.stdout).toContain("protocol 1");
    expect(result.stderr).toBe("");
  });

  it("prints usage with no command", () => {
    const result = runCli([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage:");
  });

  it("reports that no workspace is configured", () => {
    const result = runCli(["status"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("no workspace configured");
  });

  it("hands serve to the binary", () => {
    const result = runCli(["serve"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("must be run by the suite-sync binary");
  });

  it("refuses an unknown command", () => {
    const result = runCli(["wat"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unknown command");
  });
});

describe("parseServeOptions", () => {
  it("uses loopback and the default port", () => {
    expect(parseServeOptions([])).toEqual({
      ok: true,
      value: { host: DEFAULT_HOST, port: DEFAULT_PORT, workspaces: [] },
    });
  });

  it("reads host and port", () => {
    expect(parseServeOptions(["--host", "0.0.0.0", "--port", "9000"])).toEqual({
      ok: true,
      value: { host: "0.0.0.0", port: 9000, workspaces: [] },
    });
  });

  it("collects repeatable workspace directories", () => {
    expect(parseServeOptions(["--workspace", "/tmp/a", "--workspace", "/tmp/b"])).toEqual({
      ok: true,
      value: { host: DEFAULT_HOST, port: DEFAULT_PORT, workspaces: ["/tmp/a", "/tmp/b"] },
    });
  });

  it("accepts port 0 for an operating-system port", () => {
    expect(parseServeOptions(["--port", "0"])).toEqual({
      ok: true,
      value: { host: DEFAULT_HOST, port: 0, workspaces: [] },
    });
  });

  it("refuses a missing or invalid value", () => {
    expect(parseServeOptions(["--host"])).toEqual({
      ok: false,
      error: "--host needs a value",
    });
    expect(parseServeOptions(["--port"])).toEqual({
      ok: false,
      error: "--port needs a value",
    });
    expect(parseServeOptions(["--workspace"])).toEqual({
      ok: false,
      error: "--workspace needs a directory",
    });
    expect(parseServeOptions(["--port", "70000"])).toEqual({
      ok: false,
      error: "port must be an integer from 0 to 65535",
    });
  });

  it("refuses an unknown option", () => {
    expect(parseServeOptions(["--wat"])).toEqual({
      ok: false,
      error: "unknown option: --wat",
    });
  });
});
