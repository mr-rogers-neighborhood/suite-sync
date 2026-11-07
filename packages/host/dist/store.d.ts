import { type Frame, type InviteRecord, type MemberRole, type RemovalRecord, type RoleRecord } from "@suite/sync";
/**
 * What a host keeps between process lifetimes: frames, and who may write.
 *
 * Frames are ciphertext and role records are signed public metadata — a device id and a
 * role, no content — so neither needs a key to sit on disk. The host reads the header of
 * a role record because it has to; it never reads a frame.
 *
 * Role records must be kept. A host that forgot them would refuse every frame after a
 * restart, which looks exactly like a broken workspace.
 */
export interface HostStore {
    loadFrames(workspaceId: string): Promise<readonly Frame[]>;
    appendFrame(workspaceId: string, frame: Frame): Promise<void>;
    loadRoles(workspaceId: string): Promise<readonly RoleRecord[]>;
    appendRole(workspaceId: string, record: RoleRecord): Promise<void>;
    /** Invites an owner wrote. They expire, so they are kept as records rather than as grants. */
    loadInvites(workspaceId: string): Promise<readonly InviteRecord[]>;
    appendInvite(workspaceId: string, record: InviteRecord): Promise<void>;
    /** The public key a device joined with, so its signature can be checked after a restart. */
    loadKeys(workspaceId: string): Promise<readonly PinnedKey[]>;
    appendKey(workspaceId: string, key: PinnedKey): Promise<void>;
    /**
     * Devices an owner has taken out.
     *
     * Kept for the same reason role records are: a host that forgot would keep forwarding a
     * removed device's mail, and would accept it back after a restart as if nothing happened.
     */
    loadRemovals(workspaceId: string): Promise<readonly RemovalRecord[]>;
    appendRemoval(workspaceId: string, record: RemovalRecord): Promise<void>;
    /** Forget frames that arrived before `cutoff`. A rewrite, so it runs when a window closes. */
    compact(workspaceId: string, cutoff: string): Promise<void>;
}
export interface PinnedKey {
    readonly deviceId: string;
    readonly publicKey: string;
    /** The name the device introduced itself with. */
    readonly name: string;
    /**
     * The invitation this device spent, if it spent one, and the role that invitation granted.
     *
     * Kept because the person adding the device may not have been connected when it asked, and
     * the invitation is spent the moment the key package lands. Without this a join that waited
     * for the owner would wait forever, and the honest answer to "why is it stuck" would be
     * "nobody remembers what it asked for".
     */
    readonly invitedWith?: {
        readonly inviteId: string;
        readonly role: MemberRole;
    };
}
export declare class MemoryHostStore implements HostStore {
    private readonly frames;
    private readonly invites;
    private readonly roles;
    private readonly keys;
    private readonly removals;
    loadFrames(workspaceId: string): Promise<readonly Frame[]>;
    appendFrame(workspaceId: string, frame: Frame): Promise<void>;
    loadRoles(workspaceId: string): Promise<readonly RoleRecord[]>;
    appendRole(workspaceId: string, record: RoleRecord): Promise<void>;
    loadInvites(workspaceId: string): Promise<readonly InviteRecord[]>;
    appendInvite(workspaceId: string, record: InviteRecord): Promise<void>;
    loadKeys(workspaceId: string): Promise<readonly PinnedKey[]>;
    appendKey(workspaceId: string, key: PinnedKey): Promise<void>;
    loadRemovals(workspaceId: string): Promise<readonly RemovalRecord[]>;
    appendRemoval(workspaceId: string, record: RemovalRecord): Promise<void>;
    compact(workspaceId: string, cutoff: string): Promise<void>;
}
/**
 * One append-only file per workspace, plus one for its roles.
 *
 * A crash mid-append can leave a partial line. That line is dropped on load rather than
 * failing the workspace: a torn write should cost one frame, not the room, because a frame
 * is only ever a message some device can still send again.
 */
export declare class FileHostStore implements HostStore {
    readonly directory: string;
    constructor(directory: string);
    loadFrames(workspaceId: string): Promise<readonly Frame[]>;
    appendFrame(workspaceId: string, frame: Frame): Promise<void>;
    loadRoles(workspaceId: string): Promise<readonly RoleRecord[]>;
    appendRole(workspaceId: string, record: RoleRecord): Promise<void>;
    loadInvites(workspaceId: string): Promise<readonly InviteRecord[]>;
    appendInvite(workspaceId: string, record: InviteRecord): Promise<void>;
    loadKeys(workspaceId: string): Promise<readonly PinnedKey[]>;
    appendKey(workspaceId: string, key: PinnedKey): Promise<void>;
    loadRemovals(workspaceId: string): Promise<readonly RemovalRecord[]>;
    appendRemoval(workspaceId: string, record: RemovalRecord): Promise<void>;
    compact(workspaceId: string, cutoff: string): Promise<void>;
    private appendLine;
    private framePath;
    private rolePath;
    private invitePath;
    private keyPath;
    private removalPath;
}
//# sourceMappingURL=store.d.ts.map