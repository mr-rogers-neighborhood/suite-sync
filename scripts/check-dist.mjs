#!/usr/bin/env node
/**
 * The committed package output must match a fresh build.
 *
 * This is the property the app repositories depend on: they install these packages from a
 * git tag, and a tag whose `dist` disagrees with its source hands out something nobody
 * built from that source.
 *
 * It needs a git checkout to compare against, and one environment does not have one:
 * `woodpecker-cli exec` copies the working tree into a container without `.git`. That
 * case says so out loud rather than passing quietly, because a check that cannot run and
 * says nothing is the thing this project keeps having to fix. A Woodpecker *server*
 * clones with git, so the check runs there.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// A copy of the tree can carry a `.git` that does not work — `woodpecker-cli exec`
// does exactly that — so the probe is whether git agrees it is in a work tree, not
// whether the directory exists.
if (!(await isWorkTree())) {
  process.stdout.write("check-dist: skipped — git cannot see a work tree here\n");
  process.exit(0);
}

async function isWorkTree() {
  try {
    const { stdout } = await run("git", ["rev-parse", "--is-inside-work-tree"]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

try {
  await run("git", ["diff", "--exit-code", "--stat", "--", "packages"]);
  process.stdout.write("check-dist: committed output matches a fresh build\n");
} catch (error) {
  const detail =
    typeof error === "object" && error !== null && "stdout" in error ? String(error.stdout) : "";
  process.stderr.write(`check-dist: the build changed committed output\n${detail}`);
  process.exit(1);
}
