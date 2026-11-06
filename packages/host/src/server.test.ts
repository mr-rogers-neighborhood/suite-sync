import { generateKeyPairSync, sign } from "node:crypto";
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
  roleRecordPayload,
  type SealedFrame,
  seal,
} from "@suite/sync";
import { describe, expect, it } from "vitest";
import { deviceIdFromPublicKey, ed25519Verifier } from "./crypto.js";
import { createSyncServer, HostRegistry } from "./server.js";
import { MemoryHostStore } from "./store.js";

const workspaceId = "a".repeat(64);

/** A device with a real Ed25519 key, an id derived from it, and a way to sign. */
function device() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  const publicKeyBase64 = raw.toString("base64");
  return {
    deviceId: deviceIdFromPublicKey(publicKeyBase64),
    publicKey: publicKeyBase64,
    sign: (payload: Uint8Array | string) =>
      sign(null, Buffer.from(payload), privateKey).toString("base64"),
  };
}

const owner = device();
const second = device();

/** A client of the relay: sends messages, collects what the host hands back. */
class RelayClient {
  readonly messages: RelayHostMessage[] = [];
  private waiters: Array<() => void> = [];

  private constructor(private readonly socket: WebSocket) {
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

async function started(store = new MemoryHostStore()) {
  const server = await createSyncServer({
    registry: new HostRegistry(),
    port: 0,
    store,
    verifyFrame: ed25519Verifier,
    verifyRole: ed25519Verifier,
    now: () => new Date("2026-11-06T12:00:00.000Z"),
  });
  return { server, store };
}

function roleRecord(
  actor: ReturnType<typeof device>,
  target: { deviceId: string },
  role: "owner" | "editor" | "viewer",
  seq = 0,
) {
  const unsigned = {
    workspaceId,
    deviceId: target.deviceId,
    role,
    seq,
    signerId: actor.deviceId,
  } as const;
  return { ...unsigned, signature: actor.sign(roleRecordPayload(unsigned)) };
}

function sealedFrame(
  actor: ReturnType<typeof device>,
  epoch: number,
  payload: string,
): SealedFrame {
  const header = {
    kind: "application" as const,
    workspaceId,
    deviceId: actor.deviceId,
    epoch,
    payload,
  };
  return { ...header, signature: actor.sign(framePayload(header)) };
}

async function joined(client: RelayClient, who: ReturnType<typeof device>) {
  client.send({
    type: "join",
    protocolVersion: RELAY_PROTOCOL_VERSION,
    workspaceId,
    deviceId: who.deviceId,
    publicKey: who.publicKey,
    name: "a test device",
  });
  await client.until((m) => m.type === "joined");
}

describe("two devices through one host", () => {
  it("relays a document update the host cannot read", async () => {
    const { server, store } = await started();
    const ownerDevice = await createDeviceIdentity("owner-laptop");
    const joiner = await createDeviceIdentity("owner-desktop");
    const group = await createWorkspaceGroup(workspaceId, ownerDevice);
    const added = await addDevice(group, joiner.keyPackage);
    const joinedGroup = await joinWorkspaceGroup(added.welcome, joiner);

    const alice = await RelayClient.connect(server.url);
    const bob = await RelayClient.connect(server.url);
    await joined(alice, owner);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });
    await joined(bob, second);
    bob.send({ type: "role", record: roleRecord(owner, second, "editor") });

    const plaintext = '{"title":"Q4 planning"}';
    const sealed = await seal(added.group, new TextEncoder().encode(plaintext));
    alice.send({
      type: "frame",
      frame: sealedFrame(owner, sealed.group.epoch, encodeBase64(sealed.message)),
    });

    const delivered = await bob.until((m) => m.type === "frame");
    if (delivered.type !== "frame") throw new Error("expected a frame");
    expect(delivered.index).toBe(0);

    const opened = await open(joinedGroup, Buffer.from(delivered.frame.payload, "base64"));
    expect(new TextDecoder().decode(opened.plaintext ?? new Uint8Array())).toBe(plaintext);

    const kept = JSON.stringify(await store.loadFrames(workspaceId));
    expect(kept).not.toContain("Q4 planning");
    expect(kept).toContain(workspaceId);

    alice.close();
    bob.close();
    await server.close();
  });

  it("refuses a viewer's frame and stores nothing", async () => {
    const { server, store } = await started();
    const alice = await RelayClient.connect(server.url);
    await joined(alice, owner);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });
    alice.send({ type: "role", record: roleRecord(owner, second, "viewer") });

    const bob = await RelayClient.connect(server.url);
    await joined(bob, second);
    bob.send({ type: "frame", frame: sealedFrame(second, 1, "AAAA") });

    expect(await bob.until((m) => m.type === "refused")).toEqual({
      type: "refused",
      reason: "not-authorized",
    });
    expect(await store.loadFrames(workspaceId)).toHaveLength(0);

    alice.close();
    bob.close();
    await server.close();
  });

  it("tells a device who else is in the workspace, and what each may do", async () => {
    const { server } = await started();
    const alice = await RelayClient.connect(server.url);
    await joined(alice, owner);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });
    await alice.until((m) => m.type === "applied");

    const bob = await RelayClient.connect(server.url);
    await joined(bob, second);

    // A device that joins is told who its neighbours are, because every decision a person is
    // asked to make here is a decision about a named device. A device with a pinned key but no
    // role is waiting to be let in rather than here, so it is not on the list.
    const greeting = bob.messages.find((message) => message.type === "joined");
    expect(greeting).toMatchObject({
      members: [{ deviceId: owner.deviceId, name: "a test device", role: "owner" }],
    });

    alice.close();
    bob.close();
    await server.close();
  });

  it("hands a returning device only what it has not seen", async () => {
    const { server } = await started();
    const alice = await RelayClient.connect(server.url);
    await joined(alice, owner);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });

    for (const epoch of [1, 2, 3]) {
      alice.send({ type: "frame", frame: sealedFrame(owner, epoch, "AAAA") });
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

describe("what the host remembers across a restart", () => {
  it("still knows who may write after it is rebuilt from disk", async () => {
    const store = new MemoryHostStore();
    const first = await started(store);
    const alice = await RelayClient.connect(first.server.url);
    await joined(alice, owner);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });
    await alice.until((m) => m.type === "applied");
    alice.close();
    await first.server.close();

    // A fresh host over the same store: without replayed roles, this frame is refused.
    const second_ = await started(store);
    const bob = await RelayClient.connect(second_.server.url);
    await joined(bob, owner);
    bob.send({ type: "frame", frame: sealedFrame(owner, 1, "AAAA") });

    const answer = await bob.until((m) => m.type === "frame" || m.type === "refused");
    expect(answer.type).toBe("frame");

    bob.close();
    await second_.server.close();
  });

  it("refuses a device id that arrives with a different key", async () => {
    const { server } = await started();
    const alice = await RelayClient.connect(server.url);
    await joined(alice, owner);

    const impostor = await RelayClient.connect(server.url);
    impostor.send({
      type: "join",
      protocolVersion: RELAY_PROTOCOL_VERSION,
      workspaceId,
      deviceId: owner.deviceId,
      publicKey: second.publicKey,
      name: "a test device",
    });

    const error = await impostor.until((m) => m.type === "error");
    expect(error.type === "error" && error.message).toContain("pinned");

    alice.close();
    impostor.close();
    await server.close();
  });

  it("refuses a frame signed by a key that is not the pinned one", async () => {
    const { server } = await started();
    const alice = await RelayClient.connect(server.url);
    await joined(alice, owner);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });

    const forged: SealedFrame = {
      ...sealedFrame(second, 1, "AAAA"),
      deviceId: owner.deviceId,
    };
    alice.send({ type: "frame", frame: forged });

    expect(await alice.until((m) => m.type === "refused")).toEqual({
      type: "refused",
      reason: "invalid-signature",
    });

    alice.close();
    await server.close();
  });
});

describe("the wire", () => {
  it("refuses a version it does not speak", async () => {
    const { server } = await started();
    const alice = await RelayClient.connect(server.url);
    alice.send({
      type: "join",
      protocolVersion: 999,
      workspaceId,
      deviceId: owner.deviceId,
      publicKey: owner.publicKey,
      name: "a test device",
    });
    const error = await alice.until((m) => m.type === "error");
    expect(error.type === "error" && error.code).toBe("protocol-version");
    alice.close();
    await server.close();
  });

  it("refuses a frame from a device that never joined", async () => {
    const { server } = await started();
    const alice = await RelayClient.connect(server.url);
    alice.send({ type: "frame", frame: sealedFrame(owner, 1, "AAAA") });
    const error = await alice.until((m) => m.type === "error");
    expect(error.type === "error" && error.code).toBe("not-joined");
    alice.close();
    await server.close();
  });

  it("tells the sender when its role record is refused, and nobody else", async () => {
    const { server } = await started();
    const alice = await RelayClient.connect(server.url);
    const bob = await RelayClient.connect(server.url);
    await joined(alice, owner);
    await joined(bob, second);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });

    // Bob is not an owner, so his record for himself is refused — to Bob.
    bob.send({ type: "role", record: roleRecord(second, second, "owner") });
    expect(await bob.until((m) => m.type === "refused")).toEqual({
      type: "refused",
      reason: "not-owner",
    });
    expect(alice.messages.some((m) => m.type === "refused")).toBe(false);

    alice.close();
    bob.close();
    await server.close();
  });
});

describe("the role record a host is asked to keep", () => {
  it("applies an owner's record and refuses a second owner claim", () => {
    // `applyRoleRecord` asks "may this signer sign", so the adapter resolves the id to a key.
    const byDeviceId = (payload: string, signature: string, signerId: string) => {
      const key = [owner, second].find((d) => d.deviceId === signerId)?.publicKey;
      return key !== undefined && ed25519Verifier(payload, signature, key);
    };

    const seeded = applyRoleRecord(
      createRoleState(workspaceId),
      roleRecord(owner, owner, "owner"),
      byDeviceId,
    );
    expect(seeded.ok).toBe(true);

    const second_ = applyRoleRecord(
      seeded.ok ? seeded.state : createRoleState(workspaceId),
      roleRecord(second, second, "owner"),
      byDeviceId,
    );
    expect(second_).toEqual({ ok: false, reason: "not-owner" });
  });
});
