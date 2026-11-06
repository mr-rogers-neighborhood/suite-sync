#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { type MemberRole, SYNC_PROTOCOL_VERSION } from "@suite/sync";
import { createSyncServer, RoomRegistry } from "./server.js";
import { loadWorkspace } from "./workspace.js";
import {
  addWorkspaceMember,
  formatWorkspaceSummary,
  initWorkspace,
  showWorkspace,
} from "./workspaceCli.js";

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
  readonly workspaces: readonly string[];
}

export type ServeOptionsParse =
  | { readonly ok: true; readonly value: ServeOptions }
  | { readonly ok: false; readonly error: string };

const USAGE = `suite-sync ${SERVER_VERSION} (protocol ${SYNC_PROTOCOL_VERSION})

Usage:
  suite-sync --version                              print the server and protocol versions
  suite-sync status                                 report whether a workspace is configured
  suite-sync serve [--host <host>] [--port <port>] [--workspace <dir>]...

  suite-sync workspace init <dir> [--from-canvas <file>] [--workspace <id>]
      [--owner <id>] [--editor <id>] [--force]
  suite-sync workspace show <dir>
  suite-sync workspace add-member <dir> --member <id> --role editor|viewer [--name <name>]

A workspace directory holds \`membership.json\` and an optional \`snapshot.loro\`.
The server starts with no workspaces when none are named.
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
    case "workspace":
      return {
        code: 1,
        stdout: "",
        stderr: `${command} must be run by the suite-sync binary\n`,
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
  const workspaces: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;

    if (argument === "--workspace") {
      const value = argv[index + 1]?.trim();
      if (value === undefined || value.length === 0) {
        return { ok: false, error: "--workspace needs a directory" };
      }
      workspaces.push(value);
      index += 1;
      continue;
    }

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

  return { ok: true, value: { host, port, workspaces } };
}

/** Start the server and keep the process alive until SIGINT or SIGTERM. */
export async function serve(options: ServeOptions): Promise<void> {
  const registry = new RoomRegistry();
  for (const directory of options.workspaces) {
    registry.add(await loadWorkspace(directory));
  }

  const server = await createSyncServer({
    registry,
    host: options.host,
    port: options.port,
  });

  process.stdout.write(`${SERVER_NAME} listening on ${server.url}\n`);
  process.stdout.write(`${SERVER_NAME}: ${registry.size} workspace(s)\n`);

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

export async function runWorkspaceCommand(argv: readonly string[]): Promise<CliResult> {
  const [subcommand, directory, ...rest] = argv;

  try {
    if (subcommand === "init") {
      if (directory === undefined || directory.startsWith("--")) {
        return { code: 1, stdout: "", stderr: "workspace init needs a directory\n" };
      }
      const fromCanvas = flagValue(rest, "--from-canvas");
      const workspaceId = flagValue(rest, "--workspace");
      const ownerId = flagValue(rest, "--owner");
      const editorId = flagValue(rest, "--editor");
      const summary = await initWorkspace({
        directory,
        ...(fromCanvas === undefined ? {} : { fromCanvas }),
        ...(workspaceId === undefined ? {} : { workspaceId }),
        ...(ownerId === undefined ? {} : { ownerId }),
        ...(editorId === undefined ? {} : { editorId }),
        force: rest.includes("--force"),
      });
      return { code: 0, stdout: formatWorkspaceSummary(summary), stderr: "" };
    }

    if (subcommand === "show") {
      if (directory === undefined || directory.startsWith("--")) {
        return { code: 1, stdout: "", stderr: "workspace show needs a directory\n" };
      }
      return {
        code: 0,
        stdout: formatWorkspaceSummary(await showWorkspace(directory)),
        stderr: "",
      };
    }

    if (subcommand === "add-member") {
      if (directory === undefined || directory.startsWith("--")) {
        return { code: 1, stdout: "", stderr: "workspace add-member needs a directory\n" };
      }
      const memberId = flagValue(rest, "--member");
      const role = flagValue(rest, "--role");
      if (memberId === undefined) {
        return { code: 1, stdout: "", stderr: "--member is required\n" };
      }
      if (role !== "editor" && role !== "viewer") {
        return { code: 1, stdout: "", stderr: "--role must be editor or viewer\n" };
      }
      const summary = await addWorkspaceMember(directory, {
        memberId,
        role: role as MemberRole,
        displayName: flagValue(rest, "--name") ?? "Member",
      });
      return { code: 0, stdout: formatWorkspaceSummary(summary), stderr: "" };
    }

    return {
      code: 1,
      stdout: "",
      stderr: "workspace needs init, show or add-member\n",
    };
  } catch (error) {
    return {
      code: 1,
      stdout: "",
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
}

function flagValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  return argv[index + 1];
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
      try {
        await serve(parsed.value);
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    }
  } else if (command === "workspace") {
    const result = await runWorkspaceCommand(process.argv.slice(3));
    if (result.stdout.length > 0) process.stdout.write(result.stdout);
    if (result.stderr.length > 0) process.stderr.write(result.stderr);
    process.exitCode = result.code;
  } else {
    const result = runCli(process.argv.slice(2));
    if (result.stdout.length > 0) process.stdout.write(result.stdout);
    if (result.stderr.length > 0) process.stderr.write(result.stderr);
    process.exitCode = result.code;
  }
}
