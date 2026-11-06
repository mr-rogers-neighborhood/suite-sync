import { createServer } from "node:http";
import {
  decodeBase64,
  decodeSyncMessage,
  encodeBase64,
  encodeSyncMessage,
  isProtocolCompatible,
  SYNC_PROTOCOL_VERSION,
  type SyncErrorCode,
  type SyncHello,
  type SyncMessage,
} from "@suite/sync";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import type { RoomRejection, SyncRoom } from "./room.js";
import { MemoryRoomStore, type RoomStore } from "./store.js";

/** A stable id for updates the server itself originates. */
export const SERVER_DEVICE_ID = "0".repeat(64);

export class RoomRegistry {
  private readonly rooms = new Map<string, SyncRoom>();

  add(room: SyncRoom): void {
    this.rooms.set(room.workspaceId, room);
  }

  get(workspaceId: string): SyncRoom | undefined {
    return this.rooms.get(workspaceId);
  }

  remove(workspaceId: string): boolean {
    return this.rooms.delete(workspaceId);
  }

  list(): readonly SyncRoom[] {
    return [...this.rooms.values()];
  }

  get size(): number {
    return this.rooms.size;
  }
}

export interface SyncServerOptions {
  readonly registry: RoomRegistry;
  /** 0 asks the operating system for a free port; useful in tests. */
  readonly port?: number;
  readonly host?: string;
  readonly store?: RoomStore;
}

export interface SyncServer {
  readonly host: string;
  readonly port: number;
  /** `ws://host:port/sync` */
  readonly url: string;
  close(): Promise<void>;
}

interface SocketContext {
  readonly room: SyncRoom;
  readonly memberId: string;
  readonly deviceId: string;
}

/**
 * The WebSocket adapter around a room.
 *
 * This is Phase 2's transport, not the finished server: it has no TLS and no
 * encryption. It binds to loopback by default and is meant to be paired with
 * the identity/encryption phase before it is exposed beyond a trusted network.
 */
export async function createSyncServer(options: SyncServerOptions): Promise<SyncServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const store = options.store ?? new MemoryRoomStore();

  // A room that cannot be restored refuses the boot rather than serving an
  // empty document over a snapshot someone already trusted.
  for (const room of options.registry.list()) {
    const snapshot = await store.load(room.workspaceId);
    if (snapshot !== null) room.restore(snapshot);
  }

  const httpServer = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, rooms: options.registry.size }));
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found\n");
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/sync" });
  const contexts = new WeakMap<WebSocket, SocketContext>();
  const saveTimers = new Map<string, NodeJS.Timeout>();
  const saveChains = new Map<string, Promise<void>>();

  function enqueueSave(room: SyncRoom): void {
    const workspaceId = room.workspaceId;
    const previous = saveChains.get(workspaceId) ?? Promise.resolve();
    const next = previous
      .then(() => store.save(workspaceId, room.snapshot()))
      .catch((error: unknown) => {
        process.stderr.write(`suite-sync: could not save ${workspaceId}: ${String(error)}\n`);
      });

    saveChains.set(workspaceId, next);
    void next.finally(() => {
      if (saveChains.get(workspaceId) === next) saveChains.delete(workspaceId);
    });
  }

  function scheduleSave(room: SyncRoom): void {
    const existing = saveTimers.get(room.workspaceId);
    if (existing !== undefined) clearTimeout(existing);

    const timer = setTimeout(() => {
      saveTimers.delete(room.workspaceId);
      enqueueSave(room);
    }, 100);
    timer.unref();
    saveTimers.set(room.workspaceId, timer);
  }

  async function flushSaves(): Promise<void> {
    const dirty = [...saveTimers.keys()];
    for (const timer of saveTimers.values()) clearTimeout(timer);
    saveTimers.clear();

    for (const workspaceId of dirty) {
      const room = options.registry.get(workspaceId);
      if (room !== undefined) enqueueSave(room);
    }

    await Promise.all([...saveChains.values()]);
  }

  wss.on("connection", (socket) => {
    socket.on("message", (data) => {
      handleMessage(socket, data);
    });
  });

  function handleMessage(socket: WebSocket, data: RawData): void {
    const parsed = decodeSyncMessage(rawText(data));
    if (!parsed.ok) {
      sendError(socket, "malformed", parsed.issues.join("; "));
      return;
    }

    switch (parsed.value.type) {
      case "hello":
        handleHello(socket, parsed.value);
        return;
      case "update":
        handleUpdate(socket, parsed.value);
        return;
      case "ack":
      case "error":
        return;
    }
  }

  function handleHello(socket: WebSocket, message: SyncHello): void {
    if (contexts.has(socket)) {
      sendError(socket, "malformed", "this socket has already joined");
      return;
    }
    if (!isProtocolCompatible(message.protocolVersion)) {
      sendError(socket, "protocol-version", `this server speaks protocol ${SYNC_PROTOCOL_VERSION}`);
      return;
    }

    const room = options.registry.get(message.workspaceId);
    if (room === undefined) {
      sendError(socket, "unknown", "no such workspace");
      return;
    }

    const joined = room.join({
      memberId: message.memberId,
      deviceId: message.deviceId,
      epoch: message.epoch,
      versionVector: message.versionVector,
    });
    if (!joined.ok) {
      sendError(socket, codeFor(joined.reason), joined.reason);
      return;
    }

    contexts.set(socket, {
      room,
      memberId: message.memberId,
      deviceId: message.deviceId,
    });

    send(socket, {
      type: "ack",
      epoch: joined.epoch,
      versionVector: joined.versionVector,
    });

    if (joined.update.length > 0) {
      send(socket, {
        type: "update",
        workspaceId: room.workspaceId,
        from: SERVER_DEVICE_ID,
        to: message.deviceId,
        epoch: joined.epoch,
        payload: encodeBase64(joined.update),
      });
    }
  }

  function handleUpdate(
    socket: WebSocket,
    message: Extract<SyncMessage, { type: "update" }>,
  ): void {
    const context = contexts.get(socket);
    if (context === undefined) {
      sendError(socket, "unauthorized", "send hello first");
      return;
    }
    if (message.workspaceId !== context.room.workspaceId) {
      sendError(socket, "unauthorized", "that update belongs to another workspace");
      return;
    }
    if (message.from !== context.deviceId) {
      sendError(socket, "unauthorized", "from does not match the joined device");
      return;
    }
    if (message.epoch !== context.room.epoch) {
      sendError(socket, "epoch-mismatch", "the workspace epoch changed");
      return;
    }

    const bytes = decodeBase64(message.payload);
    if (bytes === null) {
      sendError(socket, "malformed", "the payload is not base64");
      return;
    }

    const applied = context.room.applyFrom(context.memberId, bytes);
    if (!applied.ok) {
      sendError(socket, codeFor(applied.reason), applied.reason);
      return;
    }

    scheduleSave(context.room);

    send(socket, {
      type: "ack",
      epoch: context.room.epoch,
      versionVector: applied.versionVector,
    });

    for (const client of wss.clients) {
      if (client === socket || client.readyState !== WebSocket.OPEN) continue;
      const peer = contexts.get(client);
      if (peer === undefined || peer.room !== context.room) continue;
      send(client, {
        type: "update",
        workspaceId: context.room.workspaceId,
        from: context.deviceId,
        to: peer.deviceId,
        epoch: context.room.epoch,
        payload: message.payload,
      });
    }
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      httpServer.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      httpServer.off("error", onError);
      resolve();
    };
    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
    httpServer.listen(port, host);
  });

  const address = httpServer.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    if (closing !== null) return closing;
    closing = (async () => {
      await flushSaves();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    })();
    return closing;
  };

  return {
    host,
    port: actualPort,
    url: `ws://${host}:${actualPort}/sync`,
    close,
  };
}

function rawText(data: RawData): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return data.toString("utf8");
}

function send(socket: WebSocket, message: SyncMessage): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(encodeSyncMessage(message));
}

function sendError(socket: WebSocket, code: SyncErrorCode, message: string): void {
  send(socket, { type: "error", code, message: message.slice(0, 500) });
}

function codeFor(reason: RoomRejection): SyncErrorCode {
  switch (reason) {
    case "not-member":
    case "member-inactive":
      return "unauthorized";
    case "epoch-mismatch":
      return "epoch-mismatch";
    case "viewer-cannot-write":
      return "forbidden";
    case "invalid-update":
      return "malformed";
  }
}
