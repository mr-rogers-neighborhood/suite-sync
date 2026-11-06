import { framePayload } from "./frame.js";
import { encodeRelayMessage, parseHostMessage, RELAY_PROTOCOL_VERSION, } from "./relay.js";
export function createRelayClient(options, handlers) {
    const factory = options.webSocket ?? ((url) => new WebSocket(url));
    const socket = factory(options.url);
    const send = (message) => {
        socket.send(encodeRelayMessage(message));
    };
    socket.addEventListener("message", (event) => {
        const message = parseHostMessage(safeJson(String(event.data)));
        if (message === null)
            return;
        dispatch(message, handlers);
    });
    socket.addEventListener("close", () => handlers.onClosed());
    socket.addEventListener("error", () => handlers.onClosed());
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("the host did not answer")), 15_000);
        socket.addEventListener("open", () => {
            clearTimeout(timer);
            send({
                type: "join",
                protocolVersion: RELAY_PROTOCOL_VERSION,
                workspaceId: options.workspaceId,
                deviceId: options.deviceId,
                publicKey: options.publicKey,
            });
            resolve({
                send: (frame) => send({ type: "frame", frame }),
                sendInvite: (record) => send({ type: "invite", record }),
                sendKeyPackage: (message) => send({
                    type: "keypackage",
                    inviteId: message.inviteId,
                    deviceId: message.deviceId,
                    publicKey: message.publicKey,
                    name: message.name,
                    frame: message.frame,
                }),
                since: (after) => send({ type: "since", after }),
                setRole: (record) => send({ type: "role", record }),
                close: () => socket.close(),
            });
        });
    });
}
function dispatch(message, handlers) {
    switch (message.type) {
        case "joined":
            handlers.onJoined(message);
            return;
        case "applied":
            return;
        case "frame":
            handlers.onFrame(message.index, message.frame);
            return;
        case "refused":
            handlers.onRefused(message.reason);
            return;
        case "error":
            handlers.onError(message.code, message.message);
            return;
    }
}
/**
 * Sign a frame header.
 *
 * Exported so an app does not have to re-derive the bytes it signs: the header is the
 * message, and a signature over a JSON encoding of it would be a different signature.
 */
export function signFrame(sign, header) {
    return { ...header, signature: sign(framePayload(header)) };
}
function safeJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=relayClient.js.map