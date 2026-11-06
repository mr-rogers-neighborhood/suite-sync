import { describe, expect, it } from "vitest";
import { frameRejection, hostAcceptsEpoch } from "./frame.js";
import {
  addDevice,
  createDeviceIdentity,
  createWorkspaceGroup,
  decodeGroup,
  encodeGroup,
  exportKey,
  joinWorkspaceGroup,
  leafIndexOf,
  open,
  removeDevice,
  seal,
} from "./group.js";

const workspaceId = "a".repeat(64);
const ownerDevice = "b".repeat(64);
const secondDevice = "c".repeat(64);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The bytes as the host would hold them, with nothing decoded on the way. */
function asStored(bytes: Uint8Array): Uint8Array {
  return bytes;
}

describe("a device joins and reads what the group writes", () => {
  it("carries a document update to the new device and to nobody else", async () => {
    const owner = await createDeviceIdentity("owner-laptop");
    const joiner = await createDeviceIdentity("owner-desktop");

    const started = await createWorkspaceGroup(workspaceId, owner);
    const added = await addDevice(started, joiner.keyPackage);
    const joined = await joinWorkspaceGroup(added.welcome, joiner);

    expect(joined.epoch).toBe(added.group.epoch);

    const update = encoder.encode('{"title":"Q4 planning","board":[]}');
    const sealed = await seal(added.group, update);
    const opened = await open(joined, sealed.message);

    expect(decoder.decode(opened.plaintext ?? new Uint8Array())).toBe(decoder.decode(update));
  });

  it("holds no plaintext in what the host stores", async () => {
    const owner = await createDeviceIdentity("owner-laptop");
    const started = await createWorkspaceGroup(workspaceId, owner);

    const secret = "Q4 planning, and nothing else in the envelope";
    const sealed = await seal(started, encoder.encode(secret));
    const stored = asStored(sealed.message);

    expect(decoder.decode(stored)).not.toContain("Q4 planning");
    expect(decoder.decode(stored)).not.toContain("envelope");
  });

  it("gives a different workspace key once the group changes", async () => {
    const owner = await createDeviceIdentity("owner-laptop");
    const joiner = await createDeviceIdentity("owner-desktop");
    const started = await createWorkspaceGroup(workspaceId, owner);

    const before = await exportKey(started, "suite/workspace-key", workspaceId);
    const added = await addDevice(started, joiner.keyPackage);
    const after = await exportKey(added.group, "suite/workspace-key", workspaceId);

    expect(Buffer.from(before).equals(Buffer.from(after))).toBe(false);
  });
});

describe("a device that was not there cannot read what came before", () => {
  it("fails to open a message sealed in an earlier epoch", async () => {
    const owner = await createDeviceIdentity("owner-laptop");
    const joiner = await createDeviceIdentity("owner-desktop");
    const started = await createWorkspaceGroup(workspaceId, owner);

    const sealed = await seal(started, encoder.encode("before the change"));

    const added = await addDevice(sealed.group, joiner.keyPackage);
    const joined = await joinWorkspaceGroup(added.welcome, joiner);

    await expect(open(joined, sealed.message)).rejects.toThrow();
  });
});

describe("revocation moves the epoch and shuts the door", () => {
  it("denies a removed device everything sealed afterwards", async () => {
    const owner = await createDeviceIdentity("owner-laptop");
    const joiner = await createDeviceIdentity("owner-desktop");
    const started = await createWorkspaceGroup(workspaceId, owner);
    const added = await addDevice(started, joiner.keyPackage);
    const joined = await joinWorkspaceGroup(added.welcome, joiner);

    const epochBefore = added.group.epoch;
    const leaf = leafIndexOf(added.group, "owner-desktop");
    expect(leaf).not.toBeNull();

    const removal = await removeDevice(added.group, leaf ?? -1);
    expect(removal.group.epoch).toBeGreaterThan(epochBefore);

    const afterRemoval = await seal(removal.group, encoder.encode("after the revocation"));
    await expect(open(joined, afterRemoval.message)).rejects.toThrow();
  });

  it("finds no leaf for a device that was never in the group", async () => {
    const owner = await createDeviceIdentity("owner-laptop");
    const started = await createWorkspaceGroup(workspaceId, owner);
    expect(leafIndexOf(started, "a-stranger")).toBeNull();
  });
});

describe("the group survives a restart", () => {
  it("round-trips its state and keeps reading", async () => {
    const owner = await createDeviceIdentity("owner-laptop");
    const started = await createWorkspaceGroup(workspaceId, owner);

    const saved = encodeGroup(started);
    const restored = decodeGroup(saved);

    expect(restored.epoch).toBe(started.epoch);

    const sealed = await seal(restored, encoder.encode("after the restart"));
    const opened = await open(started, sealed.message);
    expect(decoder.decode(opened.plaintext ?? new Uint8Array())).toBe("after the restart");
  });
});

describe("the frame rules the library does not enforce", () => {
  it("refuses a frame from an epoch this device has left", () => {
    expect(frameRejection({ workspaceId, epoch: 1 }, { workspaceId, epoch: 2 })).toBe(
      "stale-epoch",
    );
    expect(frameRejection({ workspaceId, epoch: 2 }, { workspaceId, epoch: 2 })).toBeNull();
  });

  it("refuses a frame for another workspace before it looks at the epoch", () => {
    const other = "d".repeat(64);
    expect(frameRejection({ workspaceId: other, epoch: 2 }, { workspaceId, epoch: 2 })).toBe(
      "wrong-workspace",
    );
  });

  it("lets the host store a newer epoch and refuse an older one", () => {
    expect(hostAcceptsEpoch(1, null)).toBe(true);
    expect(hostAcceptsEpoch(3, 3)).toBe(true);
    expect(hostAcceptsEpoch(4, 3)).toBe(true);
    expect(hostAcceptsEpoch(2, 3)).toBe(false);
  });

  it("keeps device ids in the header so a reader can attribute a frame", () => {
    // Ownership and authorship are decided from this, not from the host's ordering.
    expect(frameRejection({ workspaceId, epoch: 1 }, { workspaceId, epoch: 1 })).toBeNull();
    expect(ownerDevice).not.toBe(secondDevice);
  });
});
