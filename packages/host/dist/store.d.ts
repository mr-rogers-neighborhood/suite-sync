import { type Frame, type InviteRecord, type RoleRecord } from "@suite/sync";
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
    /** Forget frames that arrived before `cutoff`. A rewrite, so it runs when a window closes. */
    compact(workspaceId: string, cutoff: string): Promise<void>;
}
export interface PinnedKey {
    readonly deviceId: string;
    readonly publicKey: string;
}
export declare class MemoryHostStore implements HostStore {
    private readonly frames;
    private readonly invites;
    private readonly roles;
    private readonly keys;
    loadFrames(workspaceId: string): Promise<readonly Frame[]>;
    appendFrame(workspaceId: string, frame: Frame): Promise<void>;
    loadRoles(workspaceId: string): Promise<readonly RoleRecord[]>;
    appendRole(workspaceId: string, record: RoleRecord): Promise<void>;
    loadInvites(workspaceId: string): Promise<readonly InviteRecord[]>;
    appendInvite(workspaceId: string, record: InviteRecord): Promise<void>;
    loadKeys(workspaceId: string): Promise<readonly PinnedKey[]>;
    appendKey(workspaceId: string, key: PinnedKey): Promise<void>;
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
    compact(workspaceId: string, cutoff: string): Promise<void>;
    private appendLine;
    private framePath;
    private rolePath;
    private invitePath;
    private keyPath;
}
//# sourceMappingURL=store.d.ts.map