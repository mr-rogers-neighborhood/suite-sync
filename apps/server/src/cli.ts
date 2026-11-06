#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { RELAY_PROTOCOL_VERSION } from "@suite/sync";
import { createSyncServer, HostRegistry } from "./server.js";
import { FileFrameStore } from "./store.js";

export const SERVER_NAME = "suite-sync";
export const SERVER_VERSION = "0.1.0";
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8787;
export const DEFAULT_STORE = ".suite-sync";

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ServeOptions {
  readonly host: string;
  readonly port: number;
  readonly store: string;
  /**
   * Accept any signature.
   *
   * A host checks device signatures, so it needs a device key to check against — and
   * there is no key registry yet. Without this flag the server refuses to start rather
   * than run a mailbox that admits anything; with it, everything is admitted and the
   * only thing standing between a stranger and the store is the network being loopback.
   */
  readonly trustAll: boolean;
}

export type ServeOptionsParse =
  | { readonly ok: true; readonly value: ServeOptions }
  | { readonly ok: false; readonly error: string };

const USAGE = `suite-sync ${SERVER_VERSION} (relay protocol ${RELAY_PROTOCOL_VERSION})

Usage:
  suite-sync --version                   print the server and protocol versions
  suite-sync status                      report how a serve would be configured
  suite-sync serve [--host <host>] [--port <port>] [--store <dir>] [--trust-all]

The store holds one append-only file of encrypted frames per workspace. The host
cannot read a frame, merge two, or answer a question about a document.
`;

export function parseServeOptions(argv: readonly string[]): ServeOptionsParse {
  const options: { host: string; port: number; store: string; trustAll: boolean } = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    store: DEFAULT_STORE,
    trustAll: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--host":
        options.host = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--port": {
        const raw = argv[index + 1] ?? "";
        const port = Number.parseInt(raw, 10);
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
          return { ok: false, error: `not a port: ${raw}` };
        }
        options.port = port;
        index += 1;
        break;
      }
      case "--store":
        options.store = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--trust-all":
        options.trustAll = true;
        break;
      default:
        return { ok: false, error: `unknown argument: ${argument ?? ""}` };
    }
  }

  if (options.host.length === 0) return { ok: false, error: "--host needs a value" };
  if (options.store.length === 0) return { ok: false, error: "--store needs a value" };

  return { ok: true, value: options };
}

export function formatStatus(options: ServeOptions): string {
  return [
    `${SERVER_NAME} ${SERVER_VERSION} (relay protocol ${RELAY_PROTOCOL_VERSION})`,
    `address:  ${options.host}:${options.port}`,
    `store:    ${options.store}`,
    `signatures: ${options.trustAll ? "not checked (--trust-all)" : "checked"}`,
  ].join("\n");
}

export async function runCli(argv: readonly string[]): Promise<CliResult> {
  const [command, ...rest] = argv;

  if (command === "--version" || command === "version") {
    return { code: 0, stdout: `${SERVER_NAME} ${SERVER_VERSION}\n`, stderr: "" };
  }

  if (command === undefined || command === "--help" || command === "help") {
    return { code: 0, stdout: USAGE, stderr: "" };
  }

  const parsed = parseServeOptions(rest);
  if (!parsed.ok) return { code: 2, stdout: "", stderr: `${parsed.error}\n${USAGE}` };

  if (command === "status") {
    return { code: 0, stdout: `${formatStatus(parsed.value)}\n`, stderr: "" };
  }

  if (command === "serve") {
    if (!parsed.value.trustAll) {
      return {
        code: 1,
        stdout: "",
        stderr:
          "this host would check device signatures and has no device keys to check against.\n" +
          "Run with --trust-all on a loopback address, or wait for the device registry.\n",
      };
    }
    const server = await createSyncServer({
      registry: new HostRegistry(),
      host: parsed.value.host,
      port: parsed.value.port,
      store: new FileFrameStore(parsed.value.store),
      verifyFrame: () => true,
      verifyRole: () => true,
    });
    return {
      code: 0,
      stdout: `${formatStatus(parsed.value)}\nlistening on ${server.url}\n`,
      stderr: "",
    };
  }

  return { code: 2, stdout: "", stderr: `unknown command: ${command}\n${USAGE}` };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await runCli(process.argv.slice(2));
  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
