import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Frame } from "@suite/sync";
import { describe, expect, it } from "vitest";
import { FileFrameStore, MemoryFrameStore } from "./store.js";

const workspaceId = "a".repeat(64);

function frame(overrides: Partial<Frame> = {}): Frame {
  return {
    kind: "application",
    workspaceId,
    deviceId: "b".repeat(64),
    epoch: 1,
    payload: "q83vAAAA+Zg",
    signature: "any",
    receivedAt: "2026-11-06T12:00:00.000Z",
    ...overrides,
  };
}

async function folder(): Promise<string> {
  return mkdtemp(join(tmpdir(), "suite-sync-store-"));
}

describe("the store", () => {
  it("gives back what it was given, in order, through the memory store", async () => {
    const store = new MemoryFrameStore();
    await store.append(workspaceId, frame({ epoch: 1 }));
    await store.append(workspaceId, frame({ epoch: 2 }));
    const loaded = await store.load(workspaceId);
    expect(loaded.map((f) => f.epoch)).toEqual([1, 2]);
  });

  it("keeps workspaces apart", async () => {
    const store = new MemoryFrameStore();
    await store.append(workspaceId, frame());
    expect(await store.load("c".repeat(64))).toEqual([]);
  });
});

describe("the file store", () => {
  it("round-trips frames across a restart", async () => {
    const directory = await folder();
    const store = new FileFrameStore(directory);
    await store.append(workspaceId, frame({ epoch: 1 }));
    await store.append(workspaceId, frame({ epoch: 2 }));

    const reopened = new FileFrameStore(directory);
    expect((await reopened.load(workspaceId)).map((f) => f.epoch)).toEqual([1, 2]);
  });

  it("returns nothing for a workspace it has never seen", async () => {
    const store = new FileFrameStore(await folder());
    expect(await store.load(workspaceId)).toEqual([]);
  });

  it("drops a torn line rather than the workspace", async () => {
    const directory = await folder();
    const store = new FileFrameStore(directory);
    await store.append(workspaceId, frame({ epoch: 1 }));
    // A crash mid-append leaves half a line behind.
    await writeFile(
      join(directory, `${workspaceId}.frames.jsonl`),
      `${JSON.stringify(frame())}\n{"kind":"app`,
      "utf8",
    );

    const loaded = await store.load(workspaceId);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.epoch).toBe(1);
  });

  it("writes no readable document text to disk", async () => {
    const directory = await folder();
    const store = new FileFrameStore(directory);
    // The payload is what a client seals: ciphertext, never the document.
    await store.append(workspaceId, frame({ payload: "q83vAAAA+Zg" }));

    const onDisk = await readFile(join(directory, `${workspaceId}.frames.jsonl`), "utf8");
    expect(onDisk).not.toContain("Q4 planning");
    expect(onDisk).not.toContain("board");
    expect(onDisk).toContain(workspaceId);
    expect(onDisk).toContain("q83vAAAA+Zg");
  });
});
