#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { SYNC_PROTOCOL_VERSION } from "@suite/sync";
import { createSyncServer, RoomRegistry } from "./server.js";

export const SERVER_NAME = "suite-sync";
export const SERVER_VERSION = "0.1.0";
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8787;

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ServeOptions {
  readonly host: string;
  readonly port: number;
}

export type ServeOptionsParse =
  | { readonly ok: true; readonly value: ServeOptions }
  | { readonly ok: false; readonly error: string };

const USAGE = `suite-sync ${SERVER_VERSION} (protocol ${SYNC_PROTOCOL_VERSION})

Usage:
  suite-sync --version                              print the server and protocol versions
  suite-sync status                                 report whether a workspace is configured
  suite-sync serve [--host <host>] [--port <port>]  run the workspace server

The server starts with no workspaces. Phase 2 adds \`workspace add\`; until then,
\`serve\` fixes the process, the health route and the WebSocket surface.
`;

/**
 * Parse and run one command.
 *
 * Pure on purpose: the test drives the same function the binary does, so a
 * command added without a test is visible rather than discovered by a user.
 */
export function runCli(argv: readonly string[]): CliResult {
  const [command] = argv;

  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return { code: 0, stdout: USAGE, stderr: "" };
    case "--version":
    case "-v":
      return {
        code: 0,
        stdout: `${SERVER_NAME} ${SERVER_VERSION} (protocol ${SYNC_PROTOCOL_VERSION})\n`,
        stderr: "",
      };
    case "status":
      return {
        code: 0,
        stdout: `${SERVER_NAME}: no workspace configured\n`,
        stderr: "",
      };
    case "serve":
      return {
        code: 1,
        stdout: "",
        stderr: "serve must be run by the suite-sync binary\n",
      };
    default:
      return {
        code: 1,
        stdout: "",
        stderr: `unknown command: ${command}\n`,
      };
  }
}

export function parseServeOptions(argv: readonly string[]): ServeOptionsParse {
  let host = DEFAULT_HOST;
  let port = DEFAULT_PORT;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;

    if (argument === "--host") {
      const value = argv[index + 1]?.trim();
      if (value === undefined || value.length === 0) {
        return { ok: false, error: "--host needs a value" };
      }
      host = value;
      index += 1;
      continue;
    }

    if (argument === "--port") {
      const value = argv[index + 1];
      if (value === undefined) return { ok: false, error: "--port needs a value" };
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        return { ok: false, error: "port must be an integer from 0 to 65535" };
      }
      port = parsed;
      index += 1;
      continue;
    }

    return { ok: false, error: `unknown option: ${argument}` };
  }

  return { ok: true, value: { host, port } };
}

/** Start the server and keep the process alive until SIGINT or SIGTERM. */
export async function serve(options: ServeOptions): Promise<void> {
  const registry = new RoomRegistry();
  const server = await createSyncServer({
    registry,
    host: options.host,
    port: options.port,
  });

  process.stdout.write(`${SERVER_NAME} listening on ${server.url}\n`);
  process.stdout.write(`${SERVER_NAME}: no workspaces configured yet\n`);

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      void server.close().then(resolve);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}

const entry = process.argv[1];
const isMain = entry !== undefined && import.meta.url === pathToFileURL(entry).href;

if (isMain) {
  const command = process.argv[2];

  if (command === "serve") {
    const parsed = parseServeOptions(process.argv.slice(3));
    if (!parsed.ok) {
      process.stderr.write(`${parsed.error}\n`);
      process.exitCode = 1;
    } else {
      await serve(parsed.value);
    }
  } else {
    const result = runCli(process.argv.slice(2));
    if (result.stdout.length > 0) process.stdout.write(result.stdout);
    if (result.stderr.length > 0) process.stderr.write(result.stderr);
    process.exitCode = result.code;
  }
}
