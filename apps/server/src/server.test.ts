import {
  addDevice,
  applyRoleRecord,
  createDeviceIdentity,
  createRoleState,
  createWorkspaceGroup,
  encodeBase64,
  encodeRelayMessage,
  framePayload,
  joinWorkspaceGroup,
  open,
  RELAY_PROTOCOL_VERSION,
  type RelayHostMessage,
  seal,
} from "@suite/sync";
import { describe, expect, it } from "vitest";
import { createSyncServer, HostRegistry } from "./server.js";
import { MemoryFrameStore } from "./store.js";

const workspaceId = "a".repeat(64);
const ownerDevice = "b".repeat(64);
const secondDevice = "c".repeat(64);

const trustAll = () => true;

/** A client of the relay: sends frames, collects what the host hands back. */
class RelayClient {
  readonly socket: WebSocket;
  readonly messages: RelayHostMessage[] = [];
  private waiters: Array<() => void> = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      this.messages.push(JSON.parse(String(event.data)) as RelayHostMessage);
      for (const waiter of this.waiters) waiter();
      this.waiters = [];
    });
  }

  static async connect(url: string): Promise<RelayClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("socket error")), { once: true });
    });
    return new RelayClient(socket);
  }

  send(message: unknown): void {
    this.socket.send(encodeRelayMessage(message as Parameters<typeof encodeRelayMessage>[0]));
  }

  /** Wait for a message the predicate accepts, looking at everything so far. */
  async until(
    predicate: (message: RelayHostMessage) => boolean,
    timeoutMs = 2000,
  ): Promise<RelayHostMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.find(predicate);
      if (found !== undefined) return found;
      if (Date.now() > deadline) throw new Error(`timed out; saw ${JSON.stringify(this.messages)}`);
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 25);
      });
    }
  }

  close(): void {
    this.socket.close();
  }
}

async function started() {
  const store = new MemoryFrameStore();
  const server = await createSyncServer({
    registry: new HostRegistry(),
    port: 0,
    store,
    verifyFrame: trustAll,
    verifyRole: trustAll,
    now: () => new Date("2026-11-06T12:00:00.000Z"),
  });
  return { server, store };
}

function roleFor(deviceId: string, role: "owner" | "editor" | "viewer", seq = 0) {
  return {
    workspaceId,
    deviceId,
    role,
    seq,
    signerId: ownerDevice,
    signature: "any",
  } as const;
}

describe("two devices through one host", () => {
  it("relays a document update the host cannot read", async () => {
    const { server, store } = await started();
    const owner = await createDeviceIdentity("owner-laptop");
    const joiner = await createDeviceIdentity("owner-desktop");
    const group = await createWorkspaceGroup(workspaceId, owner);
    const added = await addDevice(group, joiner.keyPackage);
    const joined = await joinWorkspaceGroup(added.welcome, joiner);

    const alice = await RelayClient.connect(server.url);
    const bob = await RelayClient.connect(server.url);

    alice.send({
      type: "join",
      protocolVersion: RELAY_PROTOCOL_VERSION,
      workspaceId,
      deviceId: ownerDevice,
    });
    await alice.until((m) => m.type === "joined");
    alice.send({ type: "role", record: roleFor(ownerDevice, "owner") });

    bob.send({
      type: "join",
      protocolVersion: RELAY_PROTOCOL_VERSION,
      workspaceId,
      deviceId: secondDevice,
    });
    await bob.until((m) => m.type === "joined");
    bob.send({ type: "role", record: roleFor(secondDevice, "editor") });

    const plaintext = '{"title":"Q4 planning"}';
    const sealedMessage = await seal(added.group, new TextEncoder().encode(plaintext));

    alice.send({
      type: "frame",
      frame: {
        kind: "application",
        workspaceId,
        deviceId: ownerDevice,
        epoch: sealedMessage.group.epoch,
        payload: encodeBase64(sealedMessage.message),
        signature: "any",
      },
    });

    const delivered = await bob.until((m) => m.type === "frame");
    if (delivered.type !== "frame") throw new Error("expected a frame");
    expect(delivered.index).toBe(0);

    const opened = await open(joined, base64Bytes(delivered.frame.payload));
    expect(new TextDecoder().decode(opened.plaintext ?? new Uint8Array())).toBe(plaintext);

    // The host wrote the frame down and still holds no readable text.
    const kept = JSON.stringify(await store.load(workspaceId));
    expect(kept).not.toContain("Q4 planning");
    expect(kept).toContain(workspaceId);

    alice.close();
    bob.close();
    await server.close();
  });

  it("refuses a viewer's frame and stores nothing", async () => {
    const { server, store } = await started();
    const alice = await RelayClient.connect(server.url);
    alice.send({
      type: "join",
      protocolVersion: RELAY_PROTOCOL_VERSION,
      workspaceId,
      deviceId: ownerDevice,
    });
    await alice.until((m) => m.type === "joined");
    alice.send({ type: "role", record: roleFor(ownerDevice, "owner") });
    alice.send({ type: "role", record: roleFor(secondDevice, "viewer") });

    alice.send({
      type: "frame",
      frame: {
        kind: "application",
        workspaceId,
        deviceId: secondDevice,
        epoch: 1,
        payload: "AAAA",
        signature: "any",
      },
    });

    const refused = await alice.until((m) => m.type === "refused");
    expect(refused).toEqual({ type: "refused", reason: "not-authorized" });
    expect(await store.load(workspaceId)).toHaveLength(0);

    alice.close();
    await server.close();
  });

  it("hands a returning device only what it has not seen", async () => {
    const { server } = await started();
    const alice = await RelayClient.connect(server.url);
    alice.send({
      type: "join",
      protocolVersion: RELAY_PROTOCOL_VERSION,
      workspaceId,
      deviceId: ownerDevice,
    });
    await alice.until((m) => m.type === "joined");
    alice.send({ type: "role", record: roleFor(ownerDevice, "owner") });

    for (const epoch of [1, 2, 3]) {
      alice.send({
        type: "frame",
        frame: {
          kind: "application",
          workspaceId,
          deviceId: ownerDevice,
          epoch,
          payload: "AAAA",
          signature: "any",
        },
      });
      await alice.until((m) => m.type === "frame" && m.index === epoch - 1);
    }

    alice.messages.length = 0;
    alice.send({ type: "since", after: 2 });
    const replayed = await alice.until((m) => m.type === "frame");
    expect(replayed.type === "frame" && replayed.index).toBe(2);

    alice.close();
    await server.close();
  });
});

describe("the wire", () => {
  it("refuses a version it does not speak", async () => {
    const { server } = await started();
    const alice = await RelayClient.connect(server.url);
    alice.send({ type: "join", protocolVersion: 999, workspaceId, deviceId: ownerDevice });
    const error = await alice.until((m) => m.type === "error");
    expect(error.type === "error" && error.code).toBe("protocol-version");
    alice.close();
    await server.close();
  });

  it("refuses a frame from a device that never joined", async () => {
    const { server } = await started();
    const alice = await RelayClient.connect(server.url);
    alice.send({
      type: "frame",
      frame: {
        kind: "application",
        workspaceId,
        deviceId: ownerDevice,
        epoch: 1,
        payload: "AAAA",
        signature: "any",
      },
    });
    const error = await alice.until((m) => m.type === "error");
    expect(error.type === "error" && error.code).toBe("not-joined");
    alice.close();
    await server.close();
  });

  it("signs over the header so a rewritten epoch is a different message", () => {
    const header = {
      kind: "application" as const,
      workspaceId,
      deviceId: ownerDevice,
      epoch: 1,
      payload: "AAAA",
    };
    expect(
      Buffer.from(framePayload(header)).equals(Buffer.from(framePayload({ ...header, epoch: 2 }))),
    ).toBe(false);
  });
});

function base64Bytes(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text, "base64"));
}

describe("the role record a host is asked to keep", () => {
  it("applies an owner's record and refuses a second owner claim", () => {
    const seeded = applyRoleRecord(
      createRoleState(workspaceId),
      roleFor(ownerDevice, "owner") as Parameters<typeof applyRoleRecord>[1],
      trustAll,
    );
    expect(seeded.ok).toBe(true);

    const second = applyRoleRecord(
      seeded.ok ? seeded.state : createRoleState(workspaceId),
      { ...roleFor(secondDevice, "owner"), signerId: secondDevice } as Parameters<
        typeof applyRoleRecord
      >[1],
      trustAll,
    );
    expect(second).toEqual({ ok: false, reason: "not-owner" });
  });
});
