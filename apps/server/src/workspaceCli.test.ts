import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeBase64 } from "@suite/sync";
import { LoroDoc } from "loro-crdt";
import { afterEach, describe, expect, it } from "vitest";
import { workspaceFiles } from "./workspace.js";
import {
  addWorkspaceMember,
  formatWorkspaceSummary,
  initWorkspace,
  showWorkspace,
  syncIdFor,
} from "./workspaceCli.js";

const OWNER = "b".repeat(64);
const EDITOR = "c".repeat(64);
const VIEWER = "d".repeat(64);

let directory: string | null = null;

afterEach(async () => {
  if (directory !== null) {
    await rm(directory, { recursive: true, force: true });
    directory = null;
  }
});

async function tempDir(): Promise<string> {
  directory = await mkdtemp(join(tmpdir(), "suite-sync-init-"));
  return directory;
}

describe("workspace init", () => {
  it("creates a membership state and an empty snapshot", async () => {
    const dir = await tempDir();
    const summary = await initWorkspace({ directory: dir, ownerId: OWNER, editorId: EDITOR });

    expect(summary.workspaceId).toMatch(/^[a-f0-9]{64}$/u);
    expect(summary.epoch).toBe(1);
    expect(summary.members).toEqual([
      expect.objectContaining({ memberId: OWNER, role: "owner" }),
      expect.objectContaining({ memberId: EDITOR, role: "editor" }),
    ]);

    const files = workspaceFiles(dir);
    const snapshot = await readFile(files.snapshot);
    expect(snapshot.length).toBeGreaterThan(0);

    const shown = await showWorkspace(dir);
    expect(shown).toEqual(summary);
  });

  it("imports a canvas envelope and hashes a non-hex workspace id", async () => {
    const dir = await tempDir();
    const doc = new LoroDoc();
    doc.getMap("root").set("fromCanvas", true);
    doc.commit();

    const canvasPath = join(dir, "demo.canvas");
    await writeFile(
      canvasPath,
      JSON.stringify({
        kind: "suite.canvas",
        version: 3,
        workspaceId: "a-canvas-uuid",
        document: encodeBase64(doc.export({ mode: "snapshot" })),
      }),
    );

    const summary = await initWorkspace({
      directory: join(dir, "workspace"),
      fromCanvas: canvasPath,
      ownerId: OWNER,
      editorId: EDITOR,
    });

    expect(summary.workspaceId).toBe(createHash("sha256").update("a-canvas-uuid").digest("hex"));

    const snapshot = await readFile(workspaceFiles(join(dir, "workspace")).snapshot);
    const restored = new LoroDoc();
    restored.import(new Uint8Array(snapshot));
    expect(restored.getMap("root").get("fromCanvas")).toBe(true);
  });

  it("refuses to overwrite unless forced", async () => {
    const dir = await tempDir();
    await initWorkspace({ directory: dir, ownerId: OWNER, editorId: EDITOR });
    await expect(
      initWorkspace({ directory: dir, ownerId: OWNER, editorId: EDITOR }),
    ).rejects.toThrow("already exists");
    await expect(
      initWorkspace({ directory: dir, ownerId: OWNER, editorId: EDITOR, force: true }),
    ).resolves.toMatchObject({ epoch: 1 });
  });

  it("refuses the same owner and editor", async () => {
    const dir = await tempDir();
    await expect(
      initWorkspace({ directory: dir, ownerId: OWNER, editorId: OWNER }),
    ).rejects.toThrow("different members");
  });

  it("refuses a bad canvas file", async () => {
    const dir = await tempDir();
    const canvasPath = join(dir, "bad.canvas");
    await writeFile(canvasPath, JSON.stringify({ workspaceId: "x" }));
    await expect(
      initWorkspace({ directory: join(dir, "ws"), fromCanvas: canvasPath }),
    ).rejects.toThrow("no document snapshot");
  });
});

describe("workspace members", () => {
  it("adds a viewer and refuses a duplicate", async () => {
    const dir = await tempDir();
    await initWorkspace({ directory: dir, ownerId: OWNER, editorId: EDITOR });

    const summary = await addWorkspaceMember(dir, {
      memberId: VIEWER,
      role: "viewer",
      displayName: "Viewer",
    });
    expect(summary.members).toContainEqual(
      expect.objectContaining({ memberId: VIEWER, role: "viewer" }),
    );

    await expect(
      addWorkspaceMember(dir, { memberId: VIEWER, role: "viewer", displayName: "Again" }),
    ).rejects.toThrow("already active");
  });

  it("formats the summary", async () => {
    const dir = await tempDir();
    const summary = await initWorkspace({ directory: dir, ownerId: OWNER, editorId: EDITOR });
    const text = formatWorkspaceSummary(summary);
    expect(text).toContain(summary.workspaceId);
    expect(text).toContain(OWNER);
    expect(text).toContain(EDITOR);
    expect(text).toContain("owner");
  });
});

describe("syncIdFor", () => {
  it("keeps a 64-hex id and hashes anything else", () => {
    expect(syncIdFor(OWNER)).toBe(OWNER);
    expect(syncIdFor("a-uuid")).toMatch(/^[a-f0-9]{64}$/u);
    expect(syncIdFor("a-uuid")).toBe(syncIdFor("a-uuid"));
  });
});
