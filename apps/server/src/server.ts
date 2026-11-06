import { createServer } from "node:http";
import {
  applyRoleRecord,
  createRoleState,
  encodeRelayMessage,
  isRelayCompatible,
  parseClientMessage,
  RELAY_PROTOCOL_VERSION,
  type RelayClientMessage,
  type RoleState,
  type RoleVerifier,
} from "@suite/sync";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { admitFrame, FrameLog, type FrameVerifier } from "./blindRoom.js";
import { FileFrameStore, type FrameStore } from "./store.js";

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
  readonly store?: FrameStore;
  /** Device key check for incoming frames. */
  readonly verifyFrame: FrameVerifier;
  /** Device key check for role records. */
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
  const store = options.store ?? new FileFrameStore(".suite-sync");
  const now = options.now ?? (() => new Date());
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;

  const httpServer = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          workspaces: options.registry.size,
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

  async function roomFor(workspaceId: string): Promise<HostedRoom> {
    const existing = options.registry.get(workspaceId);
    if (existing !== undefined) return existing;

    const pending = loading.get(workspaceId);
    if (pending !== undefined) return pending;

    const created = (async () => {
      const room: HostedRoom = {
        workspaceId,
        log: new FrameLog(workspaceId),
        roles: createRoleState(workspaceId),
        sockets: new Set(),
      };
      for (const frame of await store.load(workspaceId)) room.log.append(frame);
      room.log.dropOlderThan(cutoffIso(now(), retentionDays));
      options.registry.add(room);
      return room;
    })();

    loading.set(workspaceId, created);
    try {
      return await created;
    } finally {
      loading.delete(workspaceId);
    }
  }

  wss.on("connection", (socket) => {
    socket.on("message", (data) => {
      void handleMessage(socket, data);
    });
    socket.on("close", () => {
      const context = contexts.get(socket);
      context?.room.sockets.delete(socket);
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
      case "role":
        handleRole(context, message.record);
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

  function handleRole(context: SocketContext, record: Parameters<typeof applyRoleRecord>[1]): void {
    const applied = applyRoleRecord(context.room.roles, record, options.verifyRole);
    if (!applied.ok) {
      send(context.room.sockets, {
        type: "refused",
        reason: applied.reason,
      });
      return;
    }
    context.room.roles = applied.state;
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
      options.verifyFrame,
      now().toISOString(),
    );

    if (!verdict.ok) {
      send(socket, { type: "refused", reason: verdict.reason });
      return;
    }

    const index = context.room.log.length;
    context.room.log.append(verdict.frame);
    await store.append(context.room.workspaceId, verdict.frame);

    const relayed = { type: "frame" as const, index, frame: verdict.frame };
    send(socket, relayed);
    for (const peer of context.room.sockets) {
      if (peer !== socket) send(peer, relayed);
    }
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
