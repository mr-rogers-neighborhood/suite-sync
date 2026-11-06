import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyMembershipEntries,
  createMembershipState,
  decodeBase64,
  decodeSyncMessage,
  encodeBase64,
  encodeSyncMessage,
  type MembershipAction,
  type MembershipEntry,
  type MembershipState,
  membershipEntryPayload,
  type SyncMessage,
} from "@suite/sync";
import { LoroSyncPeer } from "@suite/sync/loro";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { SyncRoom } from "./room.js";
import { createSyncServer, RoomRegistry, SERVER_DEVICE_ID, type SyncServer } from "./server.js";
import { FileRoomStore } from "./store.js";

const NOW = "2026-11-06T00:00:00.000Z";
const LATER = "2026-11-07T00:00:00.000Z";

const workspaceId = "a".repeat(64);
const ownerId = "b".repeat(64);
const editorId = "c".repeat(64);
const viewerId = "d".repeat(64);
const editorInvite = "e".repeat(64);
const viewerInvite = "f".repeat(64);

type UnsignedEntry = Omit<MembershipEntry, "signature">;

function sign(entry: UnsignedEntry, key: string): MembershipEntry {
  return { ...entry, signature: `sig:${key}:${membershipEntryPayload(entry)}` };
}

function verify(entry: MembershipEntry, key: string): boolean {
  return entry.signature === `sig:${key}:${membershipEntryPayload(entry)}`;
}

function entry(seq: number, actorId: string, action: MembershipAction): UnsignedEntry {
  return { seq, workspaceId, actorId, createdAt: NOW, action };
}

function seededMembership(): MembershipState {
  const entries: MembershipEntry[] = [
    sign(
      entry(1, ownerId, {
        type: "create",
        ownerPublicKey: "owner-key",
        displayName: "Owner",
      }),
      "owner-key",
    ),
    sign(
      entry(2, ownerId, {
        type: "invite",
        inviteId: editorInvite,
        memberId: editorId,
        publicKey: `${editorId}-key`,
        displayName: "Editor",
        role: "editor",
        expiresAt: LATER,
      }),
      "owner-key",
    ),
    sign(entry(3, editorId, { type: "accept", inviteId: editorInvite }), `${editorId}-key`),
    sign(
      entry(4, ownerId, {
        type: "invite",
        inviteId: viewerInvite,
        memberId: viewerId,
        publicKey: `${viewerId}-key`,
        displayName: "Viewer",
        role: "viewer",
        expiresAt: LATER,
      }),
      "owner-key",
    ),
    sign(entry(5, viewerId, { type: "accept", inviteId: viewerInvite }), `${viewerId}-key`),
  ];

  const result = applyMembershipEntries(createMembershipState(workspaceId), entries, verify, NOW);
  if (!result.ok) throw new Error(`seed failed: ${result.reason}`);
  return result.state;
}

interface Client {
  readonly socket: WebSocket;
  send(message: SyncMessage): void;
  next(): Promise<SyncMessage>;
  close(): void;
}

async function connect(url: string): Promise<Client> {
  const socket = new WebSocket(url);
  const queued: SyncMessage[] = [];
  const waiters: ((message: SyncMessage) => void)[] = [];

  socket.on("message", (data) => {
    const parsed = decodeSyncMessage(data.toString());
    if (!parsed.ok) return;
    const waiter = waiters.shift();
    if (waiter !== undefined) waiter(parsed.value);
    else queued.push(parsed.value);
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });

  return {
    socket,
    send: (message) => socket.send(encodeSyncMessage(message)),
    next: () =>
      new Promise<SyncMessage>((resolve, reject) => {
        const ready = queued.shift();
        if (ready !== undefined) {
          resolve(ready);
          return;
        }
        const timer = setTimeout(
          () => reject(new Error("timed out waiting for a sync message")),
          2_000,
        );
        waiters.push((message) => {
          clearTimeout(timer);
          resolve(message);
        });
      }),
    close: () => socket.close(),
  };
}

async function hello(
  client: Client,
  memberId: string,
  epoch: number,
  versionVector: Record<string, number> = {},
): Promise<void> {
  client.send({
    type: "hello",
    protocolVersion: 1,
    workspaceId,
    memberId,
    deviceId: memberId,
    epoch,
    versionVector,
  });
}

let server: SyncServer | null = null;
const clients: Client[] = [];

afterEach(async () => {
  for (const client of clients) client.close();
  clients.length = 0;
  if (server !== null) {
    await server.close();
    server = null;
  }
});

async function start(): Promise<{ server: SyncServer; room: SyncRoom }> {
  const room = new SyncRoom(workspaceId, seededMembership());
  const registry = new RoomRegistry();
  registry.add(room);
  const started = await createSyncServer({ registry, host: "127.0.0.1", port: 0 });
  server = started;
  return { server: started, room };
}

async function client(url: string): Promise<Client> {
  const connected = await connect(url);
  clients.push(connected);
  return connected;
}

describe("sync server", () => {
  it("forwards an editor update to a viewer", async () => {
    const { server: running, room } = await start();

    const editor = await client(running.url);
    await hello(editor, editorId, room.epoch);
    expect((await editor.next()).type).toBe("ack");

    const viewer = await client(running.url);
    await hello(viewer, viewerId, room.epoch);
    expect((await viewer.next()).type).toBe("ack");

    const peer = new LoroSyncPeer();
    peer.doc.getMap("root").set("card", 42);
    peer.doc.commit();

    editor.send({
      type: "update",
      workspaceId,
      from: editorId,
      to: SERVER_DEVICE_ID,
      epoch: room.epoch,
      payload: encodeBase64(peer.exportSince({})),
    });

    expect((await editor.next()).type).toBe("ack");

    const forwarded = await viewer.next();
    expect(forwarded.type).toBe("update");
    if (forwarded.type !== "update") return;

    const received = decodeBase64(forwarded.payload);
    expect(received).not.toBeNull();
    const viewerPeer = new LoroSyncPeer();
    viewerPeer.applyUpdate(received ?? new Uint8Array());
    expect(viewerPeer.doc.getMap("root").get("card")).toBe(42);
  });

  it("refuses a viewer write", async () => {
    const { server: running, room } = await start();

    const viewer = await client(running.url);
    await hello(viewer, viewerId, room.epoch);
    expect((await viewer.next()).type).toBe("ack");

    const peer = new LoroSyncPeer();
    peer.doc.getMap("root").set("card", 1);
    peer.doc.commit();

    viewer.send({
      type: "update",
      workspaceId,
      from: viewerId,
      to: SERVER_DEVICE_ID,
      epoch: room.epoch,
      payload: encodeBase64(peer.exportSince({})),
    });

    const error = await viewer.next();
    expect(error).toEqual({
      type: "error",
      code: "forbidden",
      message: "viewer-cannot-write",
    });
  });

  it("refuses a stale epoch", async () => {
    const { server: running, room } = await start();

    const editor = await client(running.url);
    await hello(editor, editorId, room.epoch + 1);

    const error = await editor.next();
    expect(error.type).toBe("error");
    if (error.type !== "error") return;
    expect(error.code).toBe("epoch-mismatch");
  });

  it("refuses an unknown workspace", async () => {
    const { server: running, room } = await start();

    const editor = await client(running.url);
    editor.send({
      type: "hello",
      protocolVersion: 1,
      workspaceId: "9".repeat(64),
      memberId: editorId,
      deviceId: editorId,
      epoch: room.epoch,
      versionVector: {},
    });

    const error = await editor.next();
    expect(error.type).toBe("error");
    if (error.type !== "error") return;
    expect(error.code).toBe("unknown");
  });

  it("sends the existing history to a late joiner", async () => {
    const { server: running, room } = await start();

    const writer = new LoroSyncPeer();
    writer.doc.getMap("root").set("card", 7);
    writer.doc.commit();
    expect(room.applyFrom(editorId, writer.exportSince({})).ok).toBe(true);

    const viewer = await client(running.url);
    await hello(viewer, viewerId, room.epoch);

    const catchUp = await viewer.next();
    expect(catchUp.type).toBe("update");
    if (catchUp.type !== "update") return;
    expect((await viewer.next()).type).toBe("ack");

    const viewerPeer = new LoroSyncPeer();
    viewerPeer.applyUpdate(decodeBase64(catchUp.payload) ?? new Uint8Array());
    expect(viewerPeer.doc.getMap("root").get("card")).toBe(7);
  });

  it("restores a saved room after a restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "suite-sync-"));
    const store = new FileRoomStore(directory);

    try {
      const firstRoom = new SyncRoom(workspaceId, seededMembership());
      const firstRegistry = new RoomRegistry();
      firstRegistry.add(firstRoom);
      const first = await createSyncServer({
        registry: firstRegistry,
        store,
        host: "127.0.0.1",
        port: 0,
      });
      server = first;

      const editor = await client(first.url);
      await hello(editor, editorId, firstRoom.epoch);
      expect((await editor.next()).type).toBe("ack");

      const peer = new LoroSyncPeer();
      peer.doc.getMap("root").set("restart", true);
      peer.doc.commit();
      editor.send({
        type: "update",
        workspaceId,
        from: editorId,
        to: SERVER_DEVICE_ID,
        epoch: firstRoom.epoch,
        payload: encodeBase64(peer.exportSince({})),
      });
      expect((await editor.next()).type).toBe("ack");

      await first.close();
      server = null;

      const secondRoom = new SyncRoom(workspaceId, seededMembership());
      const secondRegistry = new RoomRegistry();
      secondRegistry.add(secondRoom);
      const second = await createSyncServer({
        registry: secondRegistry,
        store,
        host: "127.0.0.1",
        port: 0,
      });
      server = second;

      const viewer = await client(second.url);
      await hello(viewer, viewerId, secondRoom.epoch);

      const catchUp = await viewer.next();
      expect(catchUp.type).toBe("update");
      if (catchUp.type !== "update") return;
      expect((await viewer.next()).type).toBe("ack");

      const viewerPeer = new LoroSyncPeer();
      viewerPeer.applyUpdate(decodeBase64(catchUp.payload) ?? new Uint8Array());
      expect(viewerPeer.doc.getMap("root").get("restart")).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("serves a health response", async () => {
    const { server: running } = await start();
    const response = await fetch(`http://${running.host}:${running.port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, rooms: 1 });
  });
});
