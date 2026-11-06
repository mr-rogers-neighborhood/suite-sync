import { z } from "zod";
import { type MemberRole } from "./roles.js";
/**
 * The membership log is append-only and signed. Each entry is one transition:
 * create the workspace, invite a member, accept an invite, change a role or
 * revoke a member.
 *
 * An invite names the invitee's public key, so accepting it is a signature by
 * the key the owner meant to invite, not a bearer token that anyone can use.
 */
export declare const membershipActionSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"create">;
    ownerPublicKey: z.ZodString;
    displayName: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"invite">;
    inviteId: z.ZodString;
    memberId: z.ZodString;
    publicKey: z.ZodString;
    displayName: z.ZodString;
    role: z.ZodEnum<{
        editor: "editor";
        viewer: "viewer";
    }>;
    expiresAt: z.ZodISODateTime;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"accept">;
    inviteId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"set-role">;
    memberId: z.ZodString;
    role: z.ZodEnum<{
        editor: "editor";
        viewer: "viewer";
    }>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"revoke">;
    memberId: z.ZodString;
}, z.core.$strict>], "type">;
export type MembershipAction = z.infer<typeof membershipActionSchema>;
export declare const membershipEntrySchema: z.ZodObject<{
    seq: z.ZodNumber;
    workspaceId: z.ZodString;
    actorId: z.ZodString;
    createdAt: z.ZodISODateTime;
    action: z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"create">;
        ownerPublicKey: z.ZodString;
        displayName: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"invite">;
        inviteId: z.ZodString;
        memberId: z.ZodString;
        publicKey: z.ZodString;
        displayName: z.ZodString;
        role: z.ZodEnum<{
            editor: "editor";
            viewer: "viewer";
        }>;
        expiresAt: z.ZodISODateTime;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"accept">;
        inviteId: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"set-role">;
        memberId: z.ZodString;
        role: z.ZodEnum<{
            editor: "editor";
            viewer: "viewer";
        }>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"revoke">;
        memberId: z.ZodString;
    }, z.core.$strict>], "type">;
    signature: z.ZodString;
}, z.core.$strict>;
export type MembershipEntry = z.infer<typeof membershipEntrySchema>;
export interface MemberRecord {
    readonly memberId: string;
    readonly displayName: string;
    readonly publicKey: string;
    readonly role: MemberRole;
    readonly status: "active" | "revoked";
    readonly joinedAt: string;
    /** The workspace epoch this member joined in. */
    readonly epoch: number;
}
export interface InviteRecord {
    readonly inviteId: string;
    readonly memberId: string;
    readonly publicKey: string;
    readonly displayName: string;
    readonly role: MemberRole;
    readonly expiresAt: string;
    readonly status: "pending" | "accepted" | "revoked" | "expired";
}
export interface MembershipState {
    readonly workspaceId: string;
    /** Increments when a member is revoked; it is the group-key epoch. */
    readonly epoch: number;
    readonly lastSeq: number;
    readonly members: Readonly<Record<string, MemberRecord>>;
    readonly invites: Readonly<Record<string, InviteRecord>>;
}
export declare const memberRecordSchema: z.ZodObject<{
    memberId: z.ZodString;
    displayName: z.ZodString;
    publicKey: z.ZodString;
    role: z.ZodEnum<{
        owner: "owner";
        editor: "editor";
        viewer: "viewer";
    }>;
    status: z.ZodEnum<{
        active: "active";
        revoked: "revoked";
    }>;
    joinedAt: z.ZodISODateTime;
    epoch: z.ZodNumber;
}, z.core.$strict>;
export declare const inviteRecordSchema: z.ZodObject<{
    inviteId: z.ZodString;
    memberId: z.ZodString;
    publicKey: z.ZodString;
    displayName: z.ZodString;
    role: z.ZodEnum<{
        owner: "owner";
        editor: "editor";
        viewer: "viewer";
    }>;
    expiresAt: z.ZodISODateTime;
    status: z.ZodEnum<{
        revoked: "revoked";
        pending: "pending";
        accepted: "accepted";
        expired: "expired";
    }>;
}, z.core.$strict>;
/**
 * A serialized membership state.
 *
 * This is a Phase 2 admin shape: the operator writes it beside a snapshot. The
 * signed log in `membershipEntrySchema` is the source of truth; this state is
 * what a replay produces and what the server loads before the invite flow lands.
 */
export declare const membershipStateSchema: z.ZodObject<{
    workspaceId: z.ZodString;
    epoch: z.ZodNumber;
    lastSeq: z.ZodNumber;
    members: z.ZodRecord<z.ZodString, z.ZodObject<{
        memberId: z.ZodString;
        displayName: z.ZodString;
        publicKey: z.ZodString;
        role: z.ZodEnum<{
            owner: "owner";
            editor: "editor";
            viewer: "viewer";
        }>;
        status: z.ZodEnum<{
            active: "active";
            revoked: "revoked";
        }>;
        joinedAt: z.ZodISODateTime;
        epoch: z.ZodNumber;
    }, z.core.$strict>>;
    invites: z.ZodRecord<z.ZodString, z.ZodObject<{
        inviteId: z.ZodString;
        memberId: z.ZodString;
        publicKey: z.ZodString;
        displayName: z.ZodString;
        role: z.ZodEnum<{
            owner: "owner";
            editor: "editor";
            viewer: "viewer";
        }>;
        expiresAt: z.ZodISODateTime;
        status: z.ZodEnum<{
            revoked: "revoked";
            pending: "pending";
            accepted: "accepted";
            expired: "expired";
        }>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type MembershipStateParse = {
    readonly ok: true;
    readonly value: MembershipState;
} | {
    readonly ok: false;
    readonly issues: readonly string[];
};
export declare function parseMembershipState(value: unknown): MembershipStateParse;
export type MembershipRejection = "wrong-workspace" | "wrong-seq" | "invalid-signature" | "already-initialised" | "not-member" | "member-inactive" | "member-active" | "member-exists" | "not-owner" | "invite-exists" | "unknown-invite" | "invite-not-pending" | "invite-not-yours" | "invite-expired" | "owner-cannot-be-demoted" | "owner-cannot-be-revoked" | "role-unchanged" | "self-revoke";
export type MembershipResult = {
    readonly ok: true;
    readonly state: MembershipState;
} | {
    readonly ok: false;
    readonly reason: MembershipRejection;
};
/** Verifies an entry's signature over its canonical payload. */
export type MembershipVerifier = (entry: MembershipEntry, publicKey: string) => boolean;
/** A workspace with no membership yet. The first entry must be `create`. */
export declare function createMembershipState(workspaceId: string): MembershipState;
/**
 * The bytes a signer signs. The signature is excluded so the same function can
 * be used before and after signing.
 */
export declare function membershipEntryPayload(entry: Pick<MembershipEntry, "seq" | "workspaceId" | "actorId" | "createdAt" | "action">): string;
export declare function parseMembershipEntry(value: unknown): {
    ok: true;
    value: MembershipEntry;
} | {
    ok: false;
    issues: readonly string[];
};
export declare function applyMembershipEntries(state: MembershipState, entries: readonly MembershipEntry[], verify: MembershipVerifier, now?: string): MembershipResult;
export declare function applyMembershipEntry(state: MembershipState, entry: MembershipEntry, verify: MembershipVerifier, now?: string): MembershipResult;
export declare function ownerIds(state: MembershipState): readonly string[];
export declare function activeMembers(state: MembershipState): readonly MemberRecord[];
export declare function roleOf(state: MembershipState, memberId: string): MemberRole | null;
export declare function describeMembershipRejection(reason: MembershipRejection): string;
//# sourceMappingURL=membership.d.ts.map