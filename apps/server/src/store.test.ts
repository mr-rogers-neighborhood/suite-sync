import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Frame } from "@suite/sync";
import { describe, expect, it } from "vitest";
import { FileHostStore, MemoryHostStore } from "./store.js";

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
    const store = new MemoryHostStore();
    await store.appendFrame(workspaceId, frame({ epoch: 1 }));
    await store.appendFrame(workspaceId, frame({ epoch: 2 }));
    const loaded = await store.loadFrames(workspaceId);
    expect(loaded.map((f) => f.epoch)).toEqual([1, 2]);
  });

  it("keeps workspaces apart", async () => {
    const store = new MemoryHostStore();
    await store.appendFrame(workspaceId, frame());
    expect(await store.loadFrames("c".repeat(64))).toEqual([]);
  });
});

describe("the file store", () => {
  it("round-trips frames across a restart", async () => {
    const directory = await folder();
    const store = new FileHostStore(directory);
    await store.appendFrame(workspaceId, frame({ epoch: 1 }));
    await store.appendFrame(workspaceId, frame({ epoch: 2 }));

    const reopened = new FileHostStore(directory);
    expect((await reopened.loadFrames(workspaceId)).map((f) => f.epoch)).toEqual([1, 2]);
  });

  it("returns nothing for a workspace it has never seen", async () => {
    const store = new FileHostStore(await folder());
    expect(await store.loadFrames(workspaceId)).toEqual([]);
  });

  it("drops a torn line rather than the workspace", async () => {
    const directory = await folder();
    const store = new FileHostStore(directory);
    await store.appendFrame(workspaceId, frame({ epoch: 1 }));
    // A crash mid-append leaves half a line behind.
    await writeFile(
      join(directory, `${workspaceId}.frames.jsonl`),
      `${JSON.stringify(frame())}\n{"kind":"app`,
      "utf8",
    );

    const loaded = await store.loadFrames(workspaceId);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.epoch).toBe(1);
  });

  it("writes no readable document text to disk", async () => {
    const directory = await folder();
    const store = new FileHostStore(directory);
    // The payload is what a client seals: ciphertext, never the document.
    await store.appendFrame(workspaceId, frame({ payload: "q83vAAAA+Zg" }));

    const onDisk = await readFile(join(directory, `${workspaceId}.frames.jsonl`), "utf8");
    expect(onDisk).not.toContain("Q4 planning");
    expect(onDisk).not.toContain("board");
    expect(onDisk).toContain(workspaceId);
    expect(onDisk).toContain("q83vAAAA+Zg");
  });
});

describe("what the host must not forget", () => {
  it("keeps role records, so a restart does not refuse every frame", async () => {
    const directory = await folder();
    const store = new FileHostStore(directory);
    const record = {
      workspaceId,
      deviceId: "b".repeat(64),
      role: "owner" as const,
      seq: 0,
      signerId: "b".repeat(64),
      signature: "signed",
    };
    await store.appendRole(workspaceId, record);

    const reopened = new FileHostStore(directory);
    expect(await reopened.loadRoles(workspaceId)).toEqual([record]);
  });

  it("keeps the key each device joined with", async () => {
    const directory = await folder();
    const store = new FileHostStore(directory);
    await store.appendKey(workspaceId, { deviceId: "b".repeat(64), publicKey: "a2V5" });

    const reopened = new FileHostStore(directory);
    expect(await reopened.loadKeys(workspaceId)).toEqual([
      { deviceId: "b".repeat(64), publicKey: "a2V5" },
    ]);
  });

  it("drops a torn role line rather than the roles", async () => {
    const directory = await folder();
    const store = new FileHostStore(directory);
    await store.appendRole(workspaceId, {
      workspaceId,
      deviceId: "b".repeat(64),
      role: "editor" as const,
      seq: 0,
      signerId: "b".repeat(64),
      signature: "signed",
    });
    await writeFile(join(directory, `${workspaceId}.roles.jsonl`), '{"workspaceId":\n', "utf8");
    expect(await store.loadRoles(workspaceId)).toEqual([]);
  });

  it("compacts a workspace down to the frames a window still covers", async () => {
    const directory = await folder();
    const store = new FileHostStore(directory);
    await store.appendFrame(workspaceId, frame({ receivedAt: "2026-01-01T00:00:00.000Z" }));
    await store.appendFrame(workspaceId, frame({ receivedAt: "2026-11-06T00:00:00.000Z" }));

    await store.compact(workspaceId, "2026-06-01T00:00:00.000Z");
    const kept = await store.loadFrames(workspaceId);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.receivedAt).toBe("2026-11-06T00:00:00.000Z");
  });
});
