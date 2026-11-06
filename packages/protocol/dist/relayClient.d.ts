import { type SealedFrame } from "./frame.js";
import type { InviteRecord } from "./invite.js";
import { type RelayFrame, type RelayJoined } from "./relay.js";
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
    addEventListener(type: "message", listener: (event: {
        data: unknown;
    }) => void): void;
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
    /** What this device calls itself, for the other person's screen. */
    readonly name: string;
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
    /** Publish an invitation, so the host will honour it. */
    sendInvite(record: InviteRecord): void;
    /** Ask to join, with the one thing a device with no role is allowed to send. */
    sendKeyPackage(message: {
        inviteId: string;
        deviceId: string;
        publicKey: string;
        name: string;
        frame: SealedFrame;
    }): void;
    /** Ask for everything after `after`. 0 means everything the host holds. */
    since(after: number): void;
    setRole(record: RoleRecord): void;
    close(): void;
}
export declare function createRelayClient(options: RelayClientOptions, handlers: RelayClientHandlers): Promise<RelayClient>;
/**
 * Sign a frame header.
 *
 * Exported so an app does not have to re-derive the bytes it signs: the header is the
 * message, and a signature over a JSON encoding of it would be a different signature.
 */
export declare function signFrame(sign: (payload: Uint8Array) => string, header: Omit<SealedFrame, "signature">): SealedFrame;
//# sourceMappingURL=relayClient.d.ts.map