import { generateKeyPairSync, sign } from "node:crypto";
import {
  createDeviceIdentity,
  encodeBase64,
  encodeKeyPackageBytes,
  encodeRelayMessage,
  framePayload,
  inviteRecordPayload,
  RELAY_PROTOCOL_VERSION,
  type RelayHostMessage,
  roleRecordPayload,
  sealedFrameSchema,
} from "@suite/sync";
import { describe, expect, it } from "vitest";
import { deviceIdFromPublicKey, ed25519Verifier } from "./crypto.js";
import { createSyncServer, HostRegistry } from "./server.js";
import { MemoryHostStore } from "./store.js";

const workspaceId = "ab".repeat(32);
const inviteId = "cd".repeat(32);

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
const stranger = device();

class Client {
  readonly messages: RelayHostMessage[] = [];
  private waiters: Array<() => void> = [];
  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      this.messages.push(JSON.parse(String(event.data)) as RelayHostMessage);
      for (const waiter of this.waiters) waiter();
      this.waiters = [];
    });
  }
  static async connect(url: string) {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("socket error")), { once: true });
    });
    return new Client(socket);
  }
  send(message: unknown) {
    this.socket.send(encodeRelayMessage(message as Parameters<typeof encodeRelayMessage>[0]));
  }
  async until(predicate: (m: RelayHostMessage) => boolean, timeoutMs = 2000) {
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
  close() {
    this.socket.close();
  }
}

async function started() {
  const store = new MemoryHostStore();
  const server = await createSyncServer({
    registry: new HostRegistry(),
    port: 0,
    store,
    verifyFrame: ed25519Verifier,
    verifyRole: ed25519Verifier,
    now: () => new Date("2026-11-06T12:00:00.000Z"),
  });
  const alice = await Client.connect(server.url);
  alice.send({
    type: "join",
    protocolVersion: RELAY_PROTOCOL_VERSION,
    workspaceId,
    deviceId: owner.deviceId,
    publicKey: owner.publicKey,
    name: "a test device",
  });
  await alice.until((m) => m.type === "joined");

  const owned = {
    workspaceId,
    deviceId: owner.deviceId,
    role: "owner" as const,
    seq: 0,
    signerId: owner.deviceId,
  };
  alice.send({
    type: "role",
    record: { ...owned, signature: owner.sign(roleRecordPayload(owned)) },
  });
  await alice.until((m) => m.type === "applied");
  return { server, store, alice };
}

function inviteRecord(
  expiresAt = "2026-11-07T12:00:00.000Z",
  role: "editor" | "viewer" = "editor",
) {
  const unsigned = {
    workspaceId,
    inviteId,
    role,
    expiresAt,
    signerId: owner.deviceId,
  };
  return { ...unsigned, signature: owner.sign(inviteRecordPayload(unsigned)) };
}

function keyPackageMessage(actor: ReturnType<typeof device>) {
  const identity = createDeviceIdentity("joining-laptop");
  return identity.then((created) => {
    const header = {
      kind: "keypackage" as const,
      workspaceId,
      deviceId: actor.deviceId,
      epoch: 0,
      payload: encodeBase64(encodeKeyPackageBytes(created.keyPackage)),
    };
    return {
      type: "keypackage" as const,
      inviteId,
      deviceId: actor.deviceId,
      publicKey: actor.publicKey,
      name: "a test device",
      frame: sealedFrameSchema.parse({ ...header, signature: actor.sign(framePayload(header)) }),
    };
  });
}

describe("an invited device may ask to join", () => {
  it("lets one key package through an invite, and stops after that", async () => {
    const { server, alice } = await started();
    alice.send({ type: "invite", record: inviteRecord() });
    expect(await alice.until((m) => m.type === "invited")).toMatchObject({ inviteId });

    const bob = await Client.connect(server.url);
    bob.send({
      type: "join",
      protocolVersion: RELAY_PROTOCOL_VERSION,
      workspaceId,
      deviceId: stranger.deviceId,
      publicKey: stranger.publicKey,
      name: "a test device",
    });
    await bob.until((m) => m.type === "joined");
    bob.send(await keyPackageMessage(stranger));
    const relayed = await bob.until((m) => m.type === "frame");
    expect(relayed.type === "frame" && relayed.frame.kind).toBe("keypackage");

    // The same invite a second time is a spent token, not a second member.
    const carl = device();
    const second = await Client.connect(server.url);
    second.send({
      type: "join",
      protocolVersion: RELAY_PROTOCOL_VERSION,
      workspaceId,
      deviceId: carl.deviceId,
      publicKey: carl.publicKey,
      name: "a test device",
    });
    await second.until((m) => m.type === "joined");
    second.send(await keyPackageMessage(carl));
    expect(await second.until((m) => m.type === "refused")).toMatchObject({
      reason: "invite-spent",
    });

    bob.close();
    second.close();
    alice.close();
    await server.close();
  });

  it("tells the person adding a device which invitation it spent, and in what role", async () => {
    const { server, alice } = await started();
    // A viewer invitation, because the role the person chose is the one that must come back:
    // whoever adds the device cannot look it up, since the invitation need not be theirs.
    alice.send({ type: "invite", record: inviteRecord(undefined, "viewer") });
    await alice.until((m) => m.type === "invited");

    const bob = await Client.connect(server.url);
    bob.send({
      type: "join",
      protocolVersion: RELAY_PROTOCOL_VERSION,
      workspaceId,
      deviceId: stranger.deviceId,
      publicKey: stranger.publicKey,
      name: "a test device",
    });
    await bob.until((m) => m.type === "joined");
    bob.send(await keyPackageMessage(stranger));

    const waiting = await alice.until((m) => m.type === "waiting");
    expect(waiting).toEqual({
      type: "waiting",
      deviceId: stranger.deviceId,
      name: "a test device",
      inviteId,
      role: "viewer",
    });

    // The announcement comes before the key package it describes, because the owner writes
    // the role record the moment it sees the device: a role that arrived after the frame
    // would leave it guessing, which is what this message exists to end.
    const order = alice.messages.map((m) => m.type);
    expect(order.indexOf("waiting")).toBeLessThan(order.indexOf("frame"));

    // The device asking hears nothing about itself: it is the answer to somebody else's
    // question, and a second copy on the same screen would be a second thing to explain.
    expect(bob.messages.some((m) => m.type === "waiting")).toBe(false);

    bob.close();
    alice.close();
    await server.close();
  });

  it("remembers a device that asked while the person adding it was away", async () => {
    const { server, alice } = await started();
    alice.send({ type: "invite", record: inviteRecord() });
    await alice.until((m) => m.type === "invited");
    // The person who owns the workspace closes the app. The invitation is still live.
    alice.close();

    const bob = await Client.connect(server.url);
    bob.send({
      type: "join",
      protocolVersion: RELAY_PROTOCOL_VERSION,
      workspaceId,
      deviceId: stranger.deviceId,
      publicKey: stranger.publicKey,
      name: "a test device",
    });
    await bob.until((m) => m.type === "joined");
    bob.send(await keyPackageMessage(stranger));
    await bob.until((m) => m.type === "frame");
    bob.close();

    // They come back. The invitation was spent while they were gone, so without a memory of
    // who spent it the key package would replay forever and nothing would ever happen.
    const back = await Client.connect(server.url);
    back.send({
      type: "join",
      protocolVersion: RELAY_PROTOCOL_VERSION,
      workspaceId,
      deviceId: owner.deviceId,
      publicKey: owner.publicKey,
      name: "a test device",
    });
    const waiting = await back.until((m) => m.type === "waiting");
    expect(waiting).toMatchObject({ deviceId: stranger.deviceId, role: "editor" });

    back.close();
    await server.close();
  });

  it("refuses a key package with no invite at all", async () => {
    const { server, alice } = await started();
    const bob = await Client.connect(server.url);
    bob.send({
      type: "join",
      protocolVersion: RELAY_PROTOCOL_VERSION,
      workspaceId,
      deviceId: stranger.deviceId,
      publicKey: stranger.publicKey,
      name: "a test device",
    });
    await bob.until((m) => m.type === "joined");
    bob.send(await keyPackageMessage(stranger));
    expect(await bob.until((m) => m.type === "refused")).toMatchObject({
      reason: "unknown-invite",
    });
    bob.close();
    alice.close();
    await server.close();
  });

  it("refuses an invite from somebody who is not an owner", async () => {
    const { server, alice } = await started();
    const unsigned = {
      workspaceId,
      inviteId,
      role: "editor" as const,
      expiresAt: "2026-11-07T12:00:00.000Z",
      signerId: stranger.deviceId,
    };
    alice.send({
      type: "invite",
      record: { ...unsigned, signature: stranger.sign(inviteRecordPayload(unsigned)) },
    });
    expect(await alice.until((m) => m.type === "refused")).toMatchObject({ reason: "not-owner" });
    alice.close();
    await server.close();
  });

  it("refuses an invite that expired before it was used", async () => {
    const { server, alice } = await started();
    alice.send({ type: "invite", record: inviteRecord("2026-11-05T00:00:00.000Z") });
    expect(await alice.until((m) => m.type === "refused")).toMatchObject({ reason: "expired" });
    alice.close();
    await server.close();
  });

  it("still refuses an ordinary frame from a device with no role", async () => {
    const { server, alice } = await started();
    alice.send({ type: "invite", record: inviteRecord() });
    await alice.until((m) => m.type === "invited");

    // The exception is exactly one frame kind. Everything else waits for a role record.
    const bob = await Client.connect(server.url);
    bob.send({
      type: "join",
      protocolVersion: RELAY_PROTOCOL_VERSION,
      workspaceId,
      deviceId: stranger.deviceId,
      publicKey: stranger.publicKey,
      name: "a test device",
    });
    await bob.until((m) => m.type === "joined");
    const header = {
      kind: "application" as const,
      workspaceId,
      deviceId: stranger.deviceId,
      epoch: 1,
      payload: "AAAA",
    };
    bob.send({
      type: "frame",
      frame: { ...header, signature: stranger.sign(framePayload(header)) },
    });
    expect(await bob.until((m) => m.type === "refused" || m.type === "error")).toMatchObject({
      reason: "not-authorized",
    });
    bob.close();
    alice.close();
    await server.close();
  });
});
