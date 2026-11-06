import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceDirectoryStore } from "./store.js";
import { workspaceFiles } from "./workspace.js";

const workspaceId = "a".repeat(64);

let directory: string | null = null;

afterEach(async () => {
  if (directory !== null) {
    await rm(directory, { recursive: true, force: true });
    directory = null;
  }
});

describe("WorkspaceDirectoryStore", () => {
  it("saves and loads a workspace snapshot beside membership.json", async () => {
    directory = await mkdtemp(join(tmpdir(), "suite-sync-store-"));
    const store = new WorkspaceDirectoryStore(new Map([[workspaceId, directory]]));

    expect(await store.load(workspaceId)).toBeNull();

    const bytes = Uint8Array.from([1, 2, 3, 4]);
    await store.save(workspaceId, bytes);

    expect(await store.load(workspaceId)).toEqual(bytes);
    expect(new Uint8Array(await readFile(workspaceFiles(directory).snapshot))).toEqual(bytes);
  });

  it("returns null for a workspace it does not own", async () => {
    directory = await mkdtemp(join(tmpdir(), "suite-sync-store-"));
    const store = new WorkspaceDirectoryStore(new Map());
    expect(await store.load(workspaceId)).toBeNull();
    await expect(store.save(workspaceId, new Uint8Array())).rejects.toThrow(
      "no workspace directory",
    );
  });
});
