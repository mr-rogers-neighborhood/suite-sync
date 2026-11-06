import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMembershipState, type MembershipState } from "@suite/sync";
import { LoroSyncPeer } from "@suite/sync/loro";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadWorkspace,
  WORKSPACE_MEMBERSHIP_FILE,
  WORKSPACE_SNAPSHOT_FILE,
  workspaceFiles,
} from "./workspace.js";

const NOW = "2026-11-06T00:00:00.000Z";
const workspaceId = "a".repeat(64);
const ownerId = "b".repeat(64);

let directory: string | null = null;

afterEach(async () => {
  if (directory !== null) {
    await rm(directory, { recursive: true, force: true });
    directory = null;
  }
});

function ownerState(): MembershipState {
  const base = createMembershipState(workspaceId);
  return {
    ...base,
    lastSeq: 1,
    members: {
      [ownerId]: {
        memberId: ownerId,
        displayName: "Owner",
        publicKey: "owner-key",
        role: "owner",
        status: "active",
        joinedAt: NOW,
        epoch: 1,
      },
    },
  };
}

async function workspaceDir(): Promise<string> {
  directory = await mkdtemp(join(tmpdir(), "suite-sync-workspace-"));
  return directory;
}

describe("loadWorkspace", () => {
  it("loads membership and a snapshot", async () => {
    const dir = await workspaceDir();
    const files = workspaceFiles(dir);
    await writeFile(files.membership, JSON.stringify(ownerState()));

    const peer = new LoroSyncPeer();
    peer.doc.getMap("root").set("card", 11);
    peer.doc.commit();
    await writeFile(files.snapshot, peer.doc.export({ mode: "snapshot" }));

    const room = await loadWorkspace(dir);
    expect(room.workspaceId).toBe(workspaceId);
    expect(room.epoch).toBe(1);

    const joined = room.join({
      memberId: ownerId,
      deviceId: ownerId,
      epoch: 1,
      versionVector: {},
    });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;

    const restored = new LoroSyncPeer();
    restored.applyUpdate(joined.update);
    expect(restored.doc.getMap("root").get("card")).toBe(11);
  });

  it("loads membership without a snapshot", async () => {
    const dir = await workspaceDir();
    await writeFile(join(dir, WORKSPACE_MEMBERSHIP_FILE), JSON.stringify(ownerState()));

    const room = await loadWorkspace(dir);
    expect(room.versionVector).toEqual({});
    expect(await room.snapshot()).not.toHaveLength(0);
  });

  it("refuses a missing membership file", async () => {
    const dir = await workspaceDir();
    await expect(loadWorkspace(dir)).rejects.toThrow(WORKSPACE_MEMBERSHIP_FILE);
  });

  it("refuses a malformed membership file", async () => {
    const dir = await workspaceDir();
    await writeFile(join(dir, WORKSPACE_MEMBERSHIP_FILE), "{");
    await expect(loadWorkspace(dir)).rejects.toThrow("not JSON");
  });

  it("refuses a membership file with the wrong shape", async () => {
    const dir = await workspaceDir();
    await writeFile(join(dir, WORKSPACE_MEMBERSHIP_FILE), JSON.stringify({ workspaceId }));
    await expect(loadWorkspace(dir)).rejects.toThrow("epoch");
  });

  it("reports the two file names", () => {
    expect(workspaceFiles("/tmp/ws")).toEqual({
      membership: "/tmp/ws/membership.json",
      snapshot: "/tmp/ws/snapshot.loro",
    });
    expect(WORKSPACE_SNAPSHOT_FILE).toBe("snapshot.loro");
  });
});
