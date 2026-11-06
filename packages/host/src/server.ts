import { createServer } from "node:http";
import {
  addInvite,
  applyRoleRecord,
  createInviteState,
  createRoleState,
  encodeRelayMessage,
  type InviteRecord,
  type InviteState,
  isRelayCompatible,
  liveInvite,
  parseClientMessage,
  RELAY_PROTOCOL_VERSION,
  type RelayClientMessage,
  type RoleRecord,
  type RoleState,
  type RoleVerifier,
  spendInvite,
} from "@suite/sync";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { admitFrame, FrameLog, type FrameVerifier } from "./blindRoom.js";
import { FileHostStore, type HostStore, type PinnedKey } from "./store.js";

/**
 * The host: a mailbox with an opinion about who may post.
 *
 * It accepts frames, numbers them, writes them down and hands out the ones a client has
 * not seen. It answers no question about a document, because it cannot read one.
 */
export interface HostedRoom {
  readonly workspaceId: string;
  readonly log: FrameLog;
  roles: RoleState;
  /** Invitations an owner wrote. A live one lets exactly one key package through. */
  invites: InviteState;
  /** The key each device joined with. Without it a restart could verify nothing. */
  readonly keys: Map<string, string>;
  readonly sockets: Set<WebSocket>;
}

export class HostRegistry {
  private readonly rooms = new Map<string, HostedRoom>();

  add(room: HostedRoom): void {
    this.rooms.set(room.workspaceId, room);
  }

  get(workspaceId: string): HostedRoom | undefined {
    return this.rooms.get(workspaceId);
  }

  list(): readonly HostedRoom[] {
    return [...this.rooms.values()];
  }

  get size(): number {
    return this.rooms.size;
  }
}

export interface SyncServerOptions {
  readonly registry: HostRegistry;
  /** 0 asks the operating system for a free port; useful in tests. */
  readonly port?: number;
  readonly host?: string;
  readonly store?: HostStore;
  /** Device key check for incoming frames, against the key the device joined with. */
  readonly verifyFrame: FrameVerifier;
  /** The same check for role records. */
  readonly verifyRole: RoleVerifier;
  /** How long a frame is kept. A device away longer needs a snapshot from a peer. */
  readonly retentionDays?: number;
  readonly now?: () => Date;
}

export interface SyncServer {
  readonly host: string;
  readonly port: number;
  /** `ws://host:port/sync` */
  readonly url: string;
  close(): Promise<void>;
}

interface SocketContext {
  readonly room: HostedRoom;
  readonly deviceId: string;
}

const DEFAULT_RETENTION_DAYS = 30;

export async function createSyncServer(options: SyncServerOptions): Promise<SyncServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const store = options.store ?? new FileHostStore(".suite-sync");
  const now = options.now ?? (() => new Date());
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const registry = options.registry;

  const httpServer = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          workspaces: registry.size,
          clients: wss.clients.size,
        }),
      );
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found\n");
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/sync" });
  const contexts = new WeakMap<WebSocket, SocketContext>();
  const loading = new Map<string, Promise<HostedRoom>>();

  /**
   * Load a workspace, or find the one already running.
   *
   * Roles and keys are replayed before anything else can be judged: a room that came back
   * with an empty role list would refuse every frame, which looks exactly like a broken
   * workspace rather than a forgotten file.
   */
  async function roomFor(workspaceId: string): Promise<HostedRoom> {
    const existing = registry.get(workspaceId);
    if (existing !== undefined) return existing;

    const pending = loading.get(workspaceId);
    if (pending !== undefined) return pending;

    const created = (async () => {
      const room: HostedRoom = {
        workspaceId,
        log: new FrameLog(workspaceId),
        roles: createRoleState(workspaceId),
        invites: createInviteState(workspaceId),
        keys: new Map(),
        sockets: new Set(),
      };

      for (const frame of await store.loadFrames(workspaceId)) room.log.append(frame);
      room.log.dropOlderThan(cutoffIso(now(), retentionDays));

      for (const key of await store.loadKeys(workspaceId))
        room.keys.set(key.deviceId, key.publicKey);
      for (const record of await store.loadRoles(workspaceId)) {
        const applied = applyRoleRecord(room.roles, record, roleVerifierFor(room));
        if (applied.ok) room.roles = applied.state;
      }

      registry.add(room);
      return room;
    })();

    loading.set(workspaceId, created);
    try {
      return await created;
    } finally {
      loading.delete(workspaceId);
    }
  }

  function roleVerifierFor(room: HostedRoom): RoleVerifier {
    return (payload, signature, signerId) => {
      const key = room.keys.get(signerId);
      return key !== undefined && options.verifyRole(payload, signature, key);
    };
  }

  wss.on("connection", (socket) => {
    socket.on("message", (data) => {
      void handleMessage(socket, data);
    });
    socket.on("close", () => {
      contexts.get(socket)?.room.sockets.delete(socket);
    });
  });

  async function handleMessage(socket: WebSocket, data: RawData): Promise<void> {
    const message = parseClientMessage(safeJson(rawText(data)));
    if (message === null) {
      sendError(socket, "malformed", "that is not a relay message");
      return;
    }

    if (message.type === "join") {
      await handleJoin(socket, message);
      return;
    }

    const context = contexts.get(socket);
    if (context === undefined) {
      sendError(socket, "not-joined", "join before sending anything else");
      return;
    }

    switch (message.type) {
      case "invite":
        await handleInvite(socket, context, message.record);
        return;
      case "keypackage":
        await handleKeyPackage(socket, context, message);
        return;
      case "role":
        await handleRole(socket, context, message.record);
        return;
      case "frame":
        await handleFrame(socket, context, message.frame);
        return;
      case "since":
        handleSince(socket, context, message.after);
        return;
    }
  }

  async function handleJoin(socket: WebSocket, message: RelayClientMessage): Promise<void> {
    if (message.type !== "join") return;
    if (contexts.has(socket)) {
      sendError(socket, "malformed", "this socket has already joined");
      return;
    }
    if (!isRelayCompatible(message.protocolVersion)) {
      sendError(socket, "protocol-version", `this host speaks protocol ${RELAY_PROTOCOL_VERSION}`);
      return;
    }

    const room = await roomFor(message.workspaceId);
    const pinned = room.keys.get(message.deviceId);
    if (pinned !== undefined && pinned !== message.publicKey) {
      // The same device id with a different key is either a reinstall or an impersonation.
      // Either way the host cannot tell them apart, so it refuses rather than pick.
      sendError(socket, "unknown", "that device id is already pinned to another key");
      return;
    }
    if (pinned === undefined) {
      room.keys.set(message.deviceId, message.publicKey);
      await store.appendKey(message.workspaceId, {
        deviceId: message.deviceId,
        publicKey: message.publicKey,
      });
    }

    contexts.set(socket, { room, deviceId: message.deviceId });
    room.sockets.add(socket);

    send(socket, {
      type: "joined",
      protocolVersion: RELAY_PROTOCOL_VERSION,
      workspaceId: room.workspaceId,
      newestEpoch: room.log.newestEpoch,
      frames: room.log.length,
    });
  }

  /**
   * Keep an invite an owner wrote.
   *
   * The host cannot tell who it is for — an invite is a bearer token — and that is the
   * point: the owner decides who gets in, the host only decides whether the token is real
   * and unspent.
   */
  async function handleInvite(
    socket: WebSocket,
    context: SocketContext,
    record: InviteRecord,
  ): Promise<void> {
    const added = addInvite(
      context.room.invites,
      record,
      roleVerifierFor(context.room),
      (deviceId) => context.room.roles.roles[deviceId] === "owner",
      now(),
    );
    if (!added.ok) {
      send(socket, { type: "refused", reason: added.reason });
      return;
    }
    context.room.invites = added.state;
    await store.appendInvite(context.room.workspaceId, record);
    send(socket, { type: "invited", inviteId: record.inviteId });
  }

  /**
   * The one exception to "a device with no role may not post".
   *
   * A key package is how a device asks to join, and it is what an owner needs in order to
   * let it in, so refusing it would make joining impossible. A live invite is what makes
   * the exception safe: one invite, one key package, and then it is spent.
   */
  async function handleKeyPackage(
    socket: WebSocket,
    context: SocketContext,
    message: Extract<RelayClientMessage, { type: "keypackage" }>,
  ): Promise<void> {
    const live = liveInvite(context.room.invites, message.inviteId, now());
    if (!live.ok) {
      send(socket, { type: "refused", reason: live.reason });
      return;
    }

    const pinned = context.room.keys.get(message.deviceId);
    if (pinned !== undefined && pinned !== message.publicKey) {
      sendError(socket, "unknown", "that device id is already pinned to another key");
      return;
    }

    if (pinned === undefined) {
      context.room.keys.set(message.deviceId, message.publicKey);
      await store.appendKey(context.room.workspaceId, {
        deviceId: message.deviceId,
        publicKey: message.publicKey,
      });
    }

    const verdict = admitFrame(
      message.frame,
      { workspaceId: context.room.workspaceId, newestEpoch: context.room.log.newestEpoch },
      context.room.roles,
      (deviceId) => context.room.keys.get(deviceId) ?? null,
      options.verifyFrame,
      now().toISOString(),
      // The invite is the authorisation, not a role record: this device has no role yet.
      { kindAllowedWithoutRole: "keypackage" },
    );

    if (!verdict.ok) {
      send(socket, { type: "refused", reason: verdict.reason });
      return;
    }

    context.room.invites = spendInvite(context.room.invites, message.inviteId);
    await store.appendInvite(context.room.workspaceId, live.record);

    const index = context.room.log.length;
    context.room.log.append(verdict.frame);
    await store.appendFrame(context.room.workspaceId, verdict.frame);

    const relayed = { type: "frame" as const, index, frame: verdict.frame };
    send(socket, relayed);
    for (const peer of context.room.sockets) {
      if (peer !== socket) send(peer, relayed);
    }
  }

  async function handleRole(
    socket: WebSocket,
    context: SocketContext,
    record: RoleRecord,
  ): Promise<void> {
    const applied = applyRoleRecord(context.room.roles, record, roleVerifierFor(context.room));
    if (!applied.ok) {
      // To the sender. Broadcasting one device's bad record would read as everybody's.
      send(socket, { type: "refused", reason: applied.reason });
      return;
    }
    context.room.roles = applied.state;
    await store.appendRole(context.room.workspaceId, record);
    send(socket, {
      type: "applied",
      deviceId: record.deviceId,
      role: record.role,
      seq: record.seq,
    });
  }

  async function handleFrame(
    socket: WebSocket,
    context: SocketContext,
    sealed: Parameters<typeof admitFrame>[0],
  ): Promise<void> {
    const verdict = admitFrame(
      sealed,
      { workspaceId: context.room.workspaceId, newestEpoch: context.room.log.newestEpoch },
      context.room.roles,
      (deviceId) => context.room.keys.get(deviceId) ?? null,
      options.verifyFrame,
      now().toISOString(),
    );

    if (!verdict.ok) {
      send(socket, { type: "refused", reason: verdict.reason });
      return;
    }

    const index = context.room.log.length;
    context.room.log.append(verdict.frame);
    await store.appendFrame(context.room.workspaceId, verdict.frame);
    await enforceRetention(context.room);

    const relayed = { type: "frame" as const, index, frame: verdict.frame };
    send(socket, relayed);
    for (const peer of context.room.sockets) {
      if (peer !== socket) send(peer, relayed);
    }
  }

  /** Close a retention window on a running host, not only on the next boot. */
  async function enforceRetention(room: HostedRoom): Promise<void> {
    const cutoff = cutoffIso(now(), retentionDays);
    const oldest = room.log.all()[0];
    if (oldest === undefined || oldest.receivedAt >= cutoff) return;
    room.log.dropOlderThan(cutoff);
    await store.compact(room.workspaceId, cutoff);
  }

  function handleSince(socket: WebSocket, context: SocketContext, after: number): void {
    const frames = context.room.log.since(after);
    for (const [offset, frame] of frames.entries()) {
      send(socket, { type: "frame", index: after + offset, frame });
    }
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.removeListener("error", reject);
      resolve();
    });
  });

  const address = httpServer.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : port;

  return {
    host,
    port: boundPort,
    url: `ws://${host}:${boundPort}/sync`,
    async close() {
      for (const socket of wss.clients) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

function cutoffIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function send(socket: WebSocket | Set<WebSocket>, message: unknown): void {
  const text = encodeRelayMessage(message as Parameters<typeof encodeRelayMessage>[0]);
  for (const target of socket instanceof Set ? socket : [socket]) {
    if (target.readyState === WebSocket.OPEN) target.send(text);
  }
}

function sendError(
  socket: WebSocket,
  code: "malformed" | "not-joined" | "protocol-version" | "unknown",
  message: string,
): void {
  send(socket, { type: "error", code, message });
}

function rawText(data: RawData): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return data.toString("utf8");
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Keeps the pinned-key shape visible to callers that seed a room directly. */
export type { PinnedKey };
