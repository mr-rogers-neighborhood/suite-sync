import { framePayload, type SealedFrame } from "./frame.js";
import {
  encodeRelayMessage,
  parseHostMessage,
  RELAY_PROTOCOL_VERSION,
  type RelayFrame,
  type RelayHostMessage,
  type RelayJoined,
} from "./relay.js";
import type { RoleRecord } from "./roleRecord.js";

/**
 * The client half of the relay, and nothing else.
 *
 * It opens a socket, announces this device, and turns messages into callbacks. What to do
 * with a frame — decrypt it, ignore it, ask for what it missed — is the app's business, so
 * this stays a transport that can be tested without a document anywhere near it.
 */

export interface RelayWebSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(type: "error", listener: () => void): void;
}

export type RelayWebSocketFactory = (url: string) => RelayWebSocket;

export interface RelayClientOptions {
  readonly url: string;
  readonly workspaceId: string;
  readonly deviceId: string;
  /** Base64 Ed25519 public key. The host pins it on first join. */
  readonly publicKey: string;
  /** Signs the header of every frame this client sends. */
  readonly sign: (payload: Uint8Array) => string;
  readonly webSocket?: RelayWebSocketFactory;
}

export interface RelayClientHandlers {
  readonly onJoined: (info: RelayJoined) => void;
  readonly onFrame: (index: number, frame: RelayFrame["frame"]) => void;
  readonly onRefused: (reason: string) => void;
  readonly onError: (code: string, message: string) => void;
  readonly onClosed: () => void;
}

export interface RelayClient {
  /** Seal nothing: hand over a frame this device already signed. */
  send(frame: SealedFrame): void;
  /** Ask for everything after `after`. 0 means everything the host holds. */
  since(after: number): void;
  setRole(record: RoleRecord): void;
  close(): void;
}

export function createRelayClient(
  options: RelayClientOptions,
  handlers: RelayClientHandlers,
): Promise<RelayClient> {
  const factory: RelayWebSocketFactory =
    options.webSocket ?? ((url) => new WebSocket(url) as unknown as RelayWebSocket);
  const socket = factory(options.url);

  const send = (message: unknown): void => {
    socket.send(encodeRelayMessage(message as Parameters<typeof encodeRelayMessage>[0]));
  };

  socket.addEventListener("message", (event) => {
    const message = parseHostMessage(safeJson(String(event.data)));
    if (message === null) return;
    dispatch(message, handlers);
  });
  socket.addEventListener("close", () => handlers.onClosed());
  socket.addEventListener("error", () => handlers.onClosed());

  return new Promise<RelayClient>((resolve, reject) => {
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
        send: (frame: SealedFrame) => send({ type: "frame", frame }),
        since: (after: number) => send({ type: "since", after }),
        setRole: (record: RoleRecord) => send({ type: "role", record }),
        close: () => socket.close(),
      });
    });
  });
}

function dispatch(message: RelayHostMessage, handlers: RelayClientHandlers): void {
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
export function signFrame(
  sign: (payload: Uint8Array) => string,
  header: Omit<SealedFrame, "signature">,
): SealedFrame {
  return { ...header, signature: sign(framePayload(header)) };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
