import {
  applyMembershipEntries,
  createMembershipState,
  type MembershipAction,
  type MembershipEntry,
  type MembershipState,
  membershipEntryPayload,
} from "@suite/sync";
import { LoroSyncPeer, SuiteSyncClient, type WebSocketConstructor } from "@suite/sync/loro";
import { LoroDoc } from "loro-crdt";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { SyncRoom } from "./room.js";
import { createSyncServer, RoomRegistry, type SyncServer } from "./server.js";

const NOW = "2026-11-06T00:00:00.000Z";
const LATER = "2026-11-07T00:00:00.000Z";

const workspaceId = "a".repeat(64);
const ownerId = "b".repeat(64);
const editorId = "c".repeat(64);
const editorInvite = "e".repeat(64);

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

function seed(): MembershipState {
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
  ];

  const result = applyMembershipEntries(createMembershipState(workspaceId), entries, verify, NOW);
  if (!result.ok) throw new Error(`seed failed: ${result.reason}`);
  return result.state;
}

let server: SyncServer | null = null;
const clients: SuiteSyncClient[] = [];

afterEach(async () => {
  for (const client of clients) client.dispose();
  clients.length = 0;
  if (server !== null) {
    await server.close();
    server = null;
  }
});

async function start(): Promise<{ server: SyncServer; room: SyncRoom }> {
  const room = new SyncRoom(workspaceId, seed());
  const registry = new RoomRegistry();
  registry.add(room);
  const started = await createSyncServer({ registry, host: "127.0.0.1", port: 0 });
  server = started;
  return { server: started, room };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for the condition");
}

function client(
  url: string,
  memberId: string,
  doc: LoroDoc,
  onStatus?: (status: string) => void,
): SuiteSyncClient {
  const created = new SuiteSyncClient({
    url,
    workspaceId,
    memberId,
    deviceId: memberId,
    epoch: 1,
    doc,
    WebSocket: WebSocket as unknown as WebSocketConstructor,
    reconnect: { minMs: 10, maxMs: 10 },
    flushTimeoutMs: 1_000,
    ...(onStatus === undefined ? {} : { onStatus }),
  });
  clients.push(created);
  return created;
}

async function connectClient(
  url: string,
  memberId: string,
  doc: LoroDoc,
): Promise<SuiteSyncClient> {
  let resolveConnected: (() => void) | null = null;
  const connected = new Promise<void>((resolve) => {
    resolveConnected = resolve;
  });
  const created = client(url, memberId, doc, (status) => {
    if (status === "connected") resolveConnected?.();
  });
  await created.connect();
  await connected;
  return created;
}

describe("SuiteSyncClient against the server", () => {
  it("sends an edit and a second client catches up", async () => {
    const { server: running, room } = await start();

    const ownerDoc = new LoroDoc();
    const owner = await connectClient(running.url, ownerId, ownerDoc);

    ownerDoc.getMap("root").set("card", 42);
    ownerDoc.commit();
    await owner.flush();

    const roomPeer = new LoroSyncPeer();
    roomPeer.applyUpdate(room.updatesSince({}));
    expect(roomPeer.doc.getMap("root").get("card")).toBe(42);

    const editorDoc = new LoroDoc();
    await connectClient(running.url, editorId, editorDoc);
    await waitFor(() => editorDoc.getMap("root").get("card") === 42);
    expect(editorDoc.getMap("root").get("card")).toBe(42);
  });

  it("reports an unauthorized member", async () => {
    const { server: running } = await start();

    let status = "";
    const unknown = client(running.url, "9".repeat(64), new LoroDoc(), (next) => {
      status = next;
    });
    await unknown.connect();
    await waitFor(() => status === "unauthorized");
    expect(unknown.status).toBe("unauthorized");
  });
});
