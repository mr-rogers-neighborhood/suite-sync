import { decodeBase64, encodeBase64 } from "../base64.js";
import { coversVersionVector, decodeSyncMessage, encodeSyncMessage, mergeVersionVector, SERVER_DEVICE_ID, } from "../sync.js";
import { SYNC_PROTOCOL_VERSION } from "../version.js";
import { LoroSyncPeer } from "./loroPeer.js";
const OPEN = 1;
/**
 * The client half of the Suite sync protocol.
 *
 * It owns the socket, the handshake and the version-vector catch-up. The Loro
 * document stays the caller's: local updates are forwarded, remote updates are
 * imported, and the same document keeps persisting through the app's own store.
 */
export class SuiteSyncClient {
    options;
    peer;
    ctor;
    minReconnectMs;
    maxReconnectMs;
    flushTimeoutMs;
    unsubscribeLocal;
    socket = null;
    statusValue = "disconnected";
    serverVersion = {};
    syncedOnce = false;
    closedByUser = false;
    unauthorized = false;
    reconnectAttempt = 0;
    reconnectTimer = null;
    flushWaiters = [];
    constructor(options) {
        this.options = options;
        this.peer = new LoroSyncPeer(options.doc);
        this.minReconnectMs = options.reconnect?.minMs ?? 250;
        this.maxReconnectMs = options.reconnect?.maxMs ?? 5_000;
        this.flushTimeoutMs = options.flushTimeoutMs ?? 2_000;
        const globalConstructor = globalThis.WebSocket;
        const ctor = options.WebSocket ?? globalConstructor;
        if (ctor === undefined) {
            throw new Error("SuiteSyncClient needs a WebSocket constructor");
        }
        this.ctor = ctor;
        this.unsubscribeLocal = this.peer.subscribeUpdates((update) => {
            this.sendUpdate(update);
        });
    }
    get status() {
        return this.statusValue;
    }
    get versionVector() {
        return this.peer.versionVector;
    }
    /** Open the socket, or reuse an open one. */
    async connect() {
        if (this.socket !== null && this.socket.readyState <= OPEN)
            return;
        this.closedByUser = false;
        this.unauthorized = false;
        this.setStatus("connecting");
        const socket = new this.ctor(this.options.url);
        this.socket = socket;
        await new Promise((resolve) => {
            let settled = false;
            const settle = () => {
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
                if (!this.unauthorized)
                    this.setStatus("disconnected");
                this.scheduleReconnect();
                settle();
            });
        });
    }
    /** Re-send the handshake so the server can push what this client missed. */
    async rejoin() {
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
    async flush() {
        if (this.socket === null || this.socket.readyState !== OPEN)
            return;
        const target = this.peer.versionVector;
        const diff = this.peer.exportSince(this.serverVersion);
        if (diff.length > 0)
            this.sendUpdate(diff);
        if (coversVersionVector(this.serverVersion, target))
            return;
        await new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.flushWaiters = this.flushWaiters.filter((waiter) => waiter.resolve !== resolve);
                resolve();
            }, this.flushTimeoutMs);
            this.flushWaiters.push({ target, resolve, timer });
        });
    }
    /** Stop reconnecting and close the socket. */
    dispose() {
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
    handleMessage(text) {
        const parsed = decodeSyncMessage(text);
        if (!parsed.ok)
            return;
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
    handleAck(versionVector) {
        this.serverVersion = mergeVersionVector(this.serverVersion, versionVector);
        this.setStatus("connected");
        if (!this.syncedOnce) {
            this.syncedOnce = true;
            this.options.onSynced?.();
        }
        const diff = this.peer.exportSince(this.serverVersion);
        if (diff.length > 0)
            this.sendUpdate(diff);
        for (const waiter of [...this.flushWaiters]) {
            if (!coversVersionVector(this.serverVersion, waiter.target))
                continue;
            clearTimeout(waiter.timer);
            waiter.resolve();
            this.flushWaiters = this.flushWaiters.filter((entry) => entry !== waiter);
        }
    }
    handleUpdate(payload) {
        const bytes = decodeBase64(payload);
        if (bytes === null)
            return;
        try {
            this.peer.applyUpdate(bytes);
        }
        catch {
            // A malformed peer update is ignored; the local document is unchanged.
        }
    }
    handleError(code) {
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
    sendHello() {
        if (this.socket === null || this.socket.readyState !== OPEN)
            return;
        this.socket.send(encodeSyncMessage({
            type: "hello",
            protocolVersion: SYNC_PROTOCOL_VERSION,
            workspaceId: this.options.workspaceId,
            memberId: this.options.memberId,
            deviceId: this.options.deviceId,
            epoch: this.options.epoch,
            versionVector: this.peer.versionVector,
        }));
    }
    sendUpdate(update) {
        if (update.length === 0)
            return;
        if (this.socket === null || this.socket.readyState !== OPEN)
            return;
        this.socket.send(encodeSyncMessage({
            type: "update",
            workspaceId: this.options.workspaceId,
            from: this.options.deviceId,
            to: SERVER_DEVICE_ID,
            epoch: this.options.epoch,
            payload: encodeBase64(update),
        }));
    }
    scheduleReconnect() {
        if (this.closedByUser || this.unauthorized)
            return;
        this.clearReconnect();
        const delay = Math.min(this.maxReconnectMs, this.minReconnectMs * 2 ** this.reconnectAttempt);
        this.reconnectAttempt += 1;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.connect();
        }, delay);
    }
    clearReconnect() {
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
    setStatus(status) {
        if (this.statusValue === status)
            return;
        this.statusValue = status;
        this.options.onStatus?.(status);
    }
}
function textOf(data) {
    if (typeof data === "string")
        return data;
    if (data instanceof ArrayBuffer)
        return new TextDecoder().decode(data);
    if (data instanceof Uint8Array)
        return new TextDecoder().decode(data);
    return String(data);
}
//# sourceMappingURL=suiteSyncClient.js.map