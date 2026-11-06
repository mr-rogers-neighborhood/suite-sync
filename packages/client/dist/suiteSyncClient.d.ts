import { type SyncMessage, type VersionVector } from "@suite/sync";
import type { LoroDoc } from "loro-crdt";
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
/**
 * The client half of the Suite sync protocol.
 *
 * It owns the socket, the handshake and the version-vector catch-up. The Loro
 * document stays the caller's: local updates are forwarded, remote updates are
 * imported, and the same document keeps persisting through the app's own store.
 */
export declare class SuiteSyncClient {
    private readonly options;
    private readonly peer;
    private readonly ctor;
    private readonly minReconnectMs;
    private readonly maxReconnectMs;
    private readonly flushTimeoutMs;
    private readonly unsubscribeLocal;
    private socket;
    private statusValue;
    private serverVersion;
    private syncedOnce;
    private closedByUser;
    private unauthorized;
    private reconnectAttempt;
    private reconnectTimer;
    private flushWaiters;
    constructor(options: SuiteSyncClientOptions);
    get status(): SuiteSyncStatus;
    get versionVector(): VersionVector;
    /** Open the socket, or reuse an open one. */
    connect(): Promise<void>;
    /** Re-send the handshake so the server can push what this client missed. */
    rejoin(): Promise<void>;
    /**
     * Send whatever the server is missing and wait until its acknowledgement
     * covers the current local version. Resolves on a timeout rather than
     * blocking a page hide on a dead network.
     */
    flush(): Promise<void>;
    /** Stop reconnecting and close the socket. */
    dispose(): void;
    private handleMessage;
    private handleAck;
    private handleUpdate;
    private handleError;
    private sendHello;
    private sendUpdate;
    private scheduleReconnect;
    private clearReconnect;
    private setStatus;
}
export type { SyncMessage };
//# sourceMappingURL=suiteSyncClient.d.ts.map