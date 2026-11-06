import { type InviteState, type MemberRole, type RoleState, type RoleVerifier } from "@suite/sync";
import { WebSocket } from "ws";
import { FrameLog, type FrameVerifier } from "./blindRoom.js";
import { type HostStore, type PinnedKey } from "./store.js";
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
    /**
     * Each device's key and the name it introduced itself with.
     *
     * The key is what makes verification possible after a restart; the name is what makes the
     * device recognisable to the person deciding whether to let it in, and the invitation it
     * spent is what answers "as what".
     */
    readonly keys: Map<string, {
        readonly publicKey: string;
        readonly name: string;
        readonly invitedWith?: {
            readonly inviteId: string;
            readonly role: MemberRole;
        };
    }>;
    readonly sockets: Set<WebSocket>;
}
export declare class HostRegistry {
    private readonly rooms;
    add(room: HostedRoom): void;
    get(workspaceId: string): HostedRoom | undefined;
    list(): readonly HostedRoom[];
    get size(): number;
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
export declare function createSyncServer(options: SyncServerOptions): Promise<SyncServer>;
/** Keeps the pinned-key shape visible to callers that seed a room directly. */
export type { PinnedKey };
//# sourceMappingURL=server.d.ts.map