import { createServer } from "node:http";
import { applyRoleRecord, createRoleState, encodeRelayMessage, isRelayCompatible, parseClientMessage, RELAY_PROTOCOL_VERSION, } from "@suite/sync";
import { WebSocket, WebSocketServer } from "ws";
import { admitFrame, FrameLog } from "./blindRoom.js";
import { FileHostStore } from "./store.js";
export class HostRegistry {
    rooms = new Map();
    add(room) {
        this.rooms.set(room.workspaceId, room);
    }
    get(workspaceId) {
        return this.rooms.get(workspaceId);
    }
    list() {
        return [...this.rooms.values()];
    }
    get size() {
        return this.rooms.size;
    }
}
const DEFAULT_RETENTION_DAYS = 30;
export async function createSyncServer(options) {
    const host = options.host ?? "127.0.0.1";
    const port = options.port ?? 0;
    const store = options.store ?? new FileHostStore(".suite-sync");
    const now = options.now ?? (() => new Date());
    const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    const registry = options.registry;
    const httpServer = createServer((request, response) => {
        if (request.url === "/health") {
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify({
                ok: true,
                workspaces: registry.size,
                clients: wss.clients.size,
            }));
            return;
        }
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("not found\n");
    });
    const wss = new WebSocketServer({ server: httpServer, path: "/sync" });
    const contexts = new WeakMap();
    const loading = new Map();
    /**
     * Load a workspace, or find the one already running.
     *
     * Roles and keys are replayed before anything else can be judged: a room that came back
     * with an empty role list would refuse every frame, which looks exactly like a broken
     * workspace rather than a forgotten file.
     */
    async function roomFor(workspaceId) {
        const existing = registry.get(workspaceId);
        if (existing !== undefined)
            return existing;
        const pending = loading.get(workspaceId);
        if (pending !== undefined)
            return pending;
        const created = (async () => {
            const room = {
                workspaceId,
                log: new FrameLog(workspaceId),
                roles: createRoleState(workspaceId),
                keys: new Map(),
                sockets: new Set(),
            };
            for (const frame of await store.loadFrames(workspaceId))
                room.log.append(frame);
            room.log.dropOlderThan(cutoffIso(now(), retentionDays));
            for (const key of await store.loadKeys(workspaceId))
                room.keys.set(key.deviceId, key.publicKey);
            for (const record of await store.loadRoles(workspaceId)) {
                const applied = applyRoleRecord(room.roles, record, roleVerifierFor(room));
                if (applied.ok)
                    room.roles = applied.state;
            }
            registry.add(room);
            return room;
        })();
        loading.set(workspaceId, created);
        try {
            return await created;
        }
        finally {
            loading.delete(workspaceId);
        }
    }
    function roleVerifierFor(room) {
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
    async function handleMessage(socket, data) {
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
    async function handleJoin(socket, message) {
        if (message.type !== "join")
            return;
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
    async function handleRole(socket, context, record) {
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
    async function handleFrame(socket, context, sealed) {
        const verdict = admitFrame(sealed, { workspaceId: context.room.workspaceId, newestEpoch: context.room.log.newestEpoch }, context.room.roles, (deviceId) => context.room.keys.get(deviceId) ?? null, options.verifyFrame, now().toISOString());
        if (!verdict.ok) {
            send(socket, { type: "refused", reason: verdict.reason });
            return;
        }
        const index = context.room.log.length;
        context.room.log.append(verdict.frame);
        await store.appendFrame(context.room.workspaceId, verdict.frame);
        await enforceRetention(context.room);
        const relayed = { type: "frame", index, frame: verdict.frame };
        send(socket, relayed);
        for (const peer of context.room.sockets) {
            if (peer !== socket)
                send(peer, relayed);
        }
    }
    /** Close a retention window on a running host, not only on the next boot. */
    async function enforceRetention(room) {
        const cutoff = cutoffIso(now(), retentionDays);
        const oldest = room.log.all()[0];
        if (oldest === undefined || oldest.receivedAt >= cutoff)
            return;
        room.log.dropOlderThan(cutoff);
        await store.compact(room.workspaceId, cutoff);
    }
    function handleSince(socket, context, after) {
        const frames = context.room.log.since(after);
        for (const [offset, frame] of frames.entries()) {
            send(socket, { type: "frame", index: after + offset, frame });
        }
    }
    await new Promise((resolve, reject) => {
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
            for (const socket of wss.clients)
                socket.terminate();
            await new Promise((resolve) => wss.close(() => resolve()));
            await new Promise((resolve) => httpServer.close(() => resolve()));
        },
    };
}
function cutoffIso(now, days) {
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}
function send(socket, message) {
    const text = encodeRelayMessage(message);
    for (const target of socket instanceof Set ? socket : [socket]) {
        if (target.readyState === WebSocket.OPEN)
            target.send(text);
    }
}
function sendError(socket, code, message) {
    send(socket, { type: "error", code, message });
}
function rawText(data) {
    if (typeof data === "string")
        return data;
    if (Array.isArray(data))
        return Buffer.concat(data).toString("utf8");
    return data.toString("utf8");
}
function safeJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=server.js.map