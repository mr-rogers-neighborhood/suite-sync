import {
  coversVersionVector,
  decodeBase64,
  decodeSyncMessage,
  encodeBase64,
  encodeSyncMessage,
  mergeVersionVector,
  SERVER_DEVICE_ID,
  SYNC_PROTOCOL_VERSION,
  type SyncErrorCode,
  type SyncMessage,
  type VersionVector,
} from "@suite/sync";
import type { LoroDoc } from "loro-crdt";
import { LoroSyncPeer } from "./loroPeer.js";

export type SuiteSyncStatus = "connecting" | "connected" | "disconnected" | "unauthorized";

/** The small part of a WebSocket this client uses. */
export interface MessageEventLike {
  readonly data?: unknown;
  readonly code?: number;
  readonly reason?: string;
}

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: MessageEventLike) => void): void;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

export interface SuiteSyncClientOptions {
  readonly url: string;
  readonly workspaceId: string;
  readonly memberId: string;
  readonly deviceId: string;
  readonly epoch: number;
  readonly doc: LoroDoc;
  readonly onStatus?: (status: SuiteSyncStatus) => void;
  readonly onSynced?: () => void;
  /** Injectable for tests; defaults to the platform WebSocket. */
  readonly WebSocket?: WebSocketConstructor;
  readonly reconnect?: {
    readonly minMs?: number;
    readonly maxMs?: number;
  };
  readonly flushTimeoutMs?: number;
}

const OPEN = 1;

/**
 * The client half of the Suite sync protocol.
 *
 * It owns the socket, the handshake and the version-vector catch-up. The Loro
 * document stays the caller's: local updates are forwarded, remote updates are
 * imported, and the same document keeps persisting through the app's own store.
 */
export class SuiteSyncClient {
  private readonly peer: LoroSyncPeer;
  private readonly ctor: WebSocketConstructor;
  private readonly minReconnectMs: number;
  private readonly maxReconnectMs: number;
  private readonly flushTimeoutMs: number;
  private readonly unsubscribeLocal: () => void;
  private socket: WebSocketLike | null = null;
  private statusValue: SuiteSyncStatus = "disconnected";
  private serverVersion: VersionVector = {};
  private syncedOnce = false;
  private closedByUser = false;
  private unauthorized = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private flushWaiters: {
    readonly target: VersionVector;
    readonly resolve: () => void;
    readonly timer: ReturnType<typeof setTimeout>;
  }[] = [];

  constructor(private readonly options: SuiteSyncClientOptions) {
    this.peer = new LoroSyncPeer(options.doc);
    this.minReconnectMs = options.reconnect?.minMs ?? 250;
    this.maxReconnectMs = options.reconnect?.maxMs ?? 5_000;
    this.flushTimeoutMs = options.flushTimeoutMs ?? 2_000;

    const globalConstructor = (globalThis as { WebSocket?: unknown }).WebSocket;
    const ctor = options.WebSocket ?? (globalConstructor as WebSocketConstructor | undefined);
    if (ctor === undefined) {
      throw new Error("SuiteSyncClient needs a WebSocket constructor");
    }
    this.ctor = ctor;
    this.unsubscribeLocal = this.peer.subscribeUpdates((update) => {
      this.sendUpdate(update);
    });
  }

  get status(): SuiteSyncStatus {
    return this.statusValue;
  }

  get versionVector(): VersionVector {
    return this.peer.versionVector;
  }

  /** Open the socket, or reuse an open one. */
  async connect(): Promise<void> {
    if (this.socket !== null && this.socket.readyState <= OPEN) return;

    this.closedByUser = false;
    this.unauthorized = false;
    this.setStatus("connecting");

    const socket = new this.ctor(this.options.url);
    this.socket = socket;

    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = (): void => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      socket.addEventListener("open", () => {
        this.reconnectAttempt = 0;
        this.sendHello();
        settle();
      });
      socket.addEventListener("message", (event) => {
        this.handleMessage(textOf(event.data));
      });
      socket.addEventListener("error", () => {
        this.setStatus("disconnected");
        settle();
      });
      socket.addEventListener("close", () => {
        this.socket = null;
        if (!this.unauthorized) this.setStatus("disconnected");
        this.scheduleReconnect();
        settle();
      });
    });
  }

  /** Re-send the handshake so the server can push what this client missed. */
  async rejoin(): Promise<void> {
    if (this.socket !== null && this.socket.readyState === OPEN) {
      this.sendHello();
      return;
    }
    await this.connect();
  }

  /**
   * Send whatever the server is missing and wait until its acknowledgement
   * covers the current local version. Resolves on a timeout rather than
   * blocking a page hide on a dead network.
   */
  async flush(): Promise<void> {
    if (this.socket === null || this.socket.readyState !== OPEN) return;

    const target = this.peer.versionVector;
    const diff = this.peer.exportSince(this.serverVersion);
    if (diff.length > 0) this.sendUpdate(diff);
    if (coversVersionVector(this.serverVersion, target)) return;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.flushWaiters = this.flushWaiters.filter((waiter) => waiter.resolve !== resolve);
        resolve();
      }, this.flushTimeoutMs);
      this.flushWaiters.push({ target, resolve, timer });
    });
  }

  /** Stop reconnecting and close the socket. */
  dispose(): void {
    this.closedByUser = true;
    this.unauthorized = false;
    this.clearReconnect();
    this.unsubscribeLocal();
    for (const waiter of this.flushWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    this.flushWaiters = [];
    this.socket?.close(1000, "disposed");
    this.socket = null;
    this.setStatus("disconnected");
  }

  private handleMessage(text: string): void {
    const parsed = decodeSyncMessage(text);
    if (!parsed.ok) return;

    switch (parsed.value.type) {
      case "ack":
        this.handleAck(parsed.value.versionVector);
        return;
      case "update":
        this.handleUpdate(parsed.value.payload);
        return;
      case "error":
        this.handleError(parsed.value.code);
        return;
      case "hello":
        return;
    }
  }

  private handleAck(versionVector: VersionVector): void {
    this.serverVersion = mergeVersionVector(this.serverVersion, versionVector);
    this.setStatus("connected");

    if (!this.syncedOnce) {
      this.syncedOnce = true;
      this.options.onSynced?.();
    }

    const diff = this.peer.exportSince(this.serverVersion);
    if (diff.length > 0) this.sendUpdate(diff);

    for (const waiter of [...this.flushWaiters]) {
      if (!coversVersionVector(this.serverVersion, waiter.target)) continue;
      clearTimeout(waiter.timer);
      waiter.resolve();
      this.flushWaiters = this.flushWaiters.filter((entry) => entry !== waiter);
    }
  }

  private handleUpdate(payload: string): void {
    const bytes = decodeBase64(payload);
    if (bytes === null) return;
    try {
      this.peer.applyUpdate(bytes);
    } catch {
      // A malformed peer update is ignored; the local document is unchanged.
    }
  }

  private handleError(code: SyncErrorCode): void {
    if (code === "unauthorized" || code === "forbidden" || code === "epoch-mismatch") {
      this.unauthorized = true;
      this.setStatus("unauthorized");
      this.clearReconnect();
      this.socket?.close(1000, "unauthorized");
      return;
    }

    this.setStatus("disconnected");
    this.socket?.close(1011, code);
  }

  private sendHello(): void {
    if (this.socket === null || this.socket.readyState !== OPEN) return;
    this.socket.send(
      encodeSyncMessage({
        type: "hello",
        protocolVersion: SYNC_PROTOCOL_VERSION,
        workspaceId: this.options.workspaceId,
        memberId: this.options.memberId,
        deviceId: this.options.deviceId,
        epoch: this.options.epoch,
        versionVector: this.peer.versionVector,
      }),
    );
  }

  private sendUpdate(update: Uint8Array): void {
    if (update.length === 0) return;
    if (this.socket === null || this.socket.readyState !== OPEN) return;
    this.socket.send(
      encodeSyncMessage({
        type: "update",
        workspaceId: this.options.workspaceId,
        from: this.options.deviceId,
        to: SERVER_DEVICE_ID,
        epoch: this.options.epoch,
        payload: encodeBase64(update),
      }),
    );
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.unauthorized) return;
    this.clearReconnect();

    const delay = Math.min(this.maxReconnectMs, this.minReconnectMs * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: SuiteSyncStatus): void {
    if (this.statusValue === status) return;
    this.statusValue = status;
    this.options.onStatus?.(status);
  }
}

function textOf(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  return String(data);
}

export type { SyncMessage };
