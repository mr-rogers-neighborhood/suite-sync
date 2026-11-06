import { z } from "zod";
import { type MemberRole } from "./roles.js";
/**
 * An invitation, as the host has to understand it.
 *
 * This exists to solve one bootstrap problem. A device that wants to join has no role, and
 * the host refuses a frame from a device with no role — but the device's key package is
 * exactly what an owner needs in order to let it in. So an owner writes an invite, the host
 * keeps it, and a device presenting a live invite may post exactly one thing.
 *
 * The host reads an id, an expiry and a role. It reads no content, and it cannot tell who
 * the invite is for: an invite is a bearer token by design, because the host must not be the
 * one deciding who is allowed in.
 */
export declare const inviteRecordSchema: z.ZodObject<{
    workspaceId: z.ZodString;
    inviteId: z.ZodString;
    role: z.ZodEnum<{
        owner: "owner";
        editor: "editor";
        viewer: "viewer";
    }>;
    expiresAt: z.ZodString;
    signerId: z.ZodString;
    signature: z.ZodString;
}, z.core.$strict>;
export type InviteRecord = z.infer<typeof inviteRecordSchema>;
export interface InviteState {
    readonly workspaceId: string;
    readonly invites: Readonly<Record<string, InviteRecord>>;
    /** Invites that have already let one device in. Spent, and never reusable. */
    readonly spent: Readonly<Record<string, true>>;
}
export declare const inviteRejectionSchema: z.ZodEnum<{
    "wrong-workspace": "wrong-workspace";
    "invalid-signature": "invalid-signature";
    "not-owner": "not-owner";
    expired: "expired";
    "unknown-invite": "unknown-invite";
    "invite-spent": "invite-spent";
}>;
export type InviteRejection = z.infer<typeof inviteRejectionSchema>;
export type InviteResult = {
    readonly ok: true;
    readonly state: InviteState;
} | {
    readonly ok: false;
    readonly reason: InviteRejection;
};
export type InviteVerifier = (payload: string, signature: string, signerId: string) => boolean;
export declare function createInviteState(workspaceId: string): InviteState;
export declare function inviteRecordPayload(record: Pick<InviteRecord, "workspaceId" | "inviteId" | "role" | "expiresAt" | "signerId">): string;
/**
 * Record an invite, if an owner wrote it and it has not already expired.
 *
 * `isOwner` is asked rather than inferred: membership lives in MLS and roles live in the
 * role records, and this module does not need to know which.
 */
export declare function addInvite(state: InviteState, record: InviteRecord, verify: InviteVerifier, isOwner: (deviceId: string) => boolean, now?: Date): InviteResult;
/**
 * The invite a joining device may use, or why it may not.
 *
 * Checked on every use rather than at join time only: an invite can expire while a device is
 * waiting in the lobby, and a host that accepted it anyway would be honouring a promise its
 * owner had already withdrawn.
 */
export declare function liveInvite(state: InviteState, inviteId: string, now?: Date): {
    readonly ok: true;
    readonly record: InviteRecord;
} | {
    readonly ok: false;
    reason: InviteRejection;
};
/** One invite, one device. A second attempt with the same invite is refused. */
export declare function spendInvite(state: InviteState, inviteId: string): InviteState;
/** The role a spent invite grants. */
export declare function invitedRole(state: InviteState, inviteId: string): MemberRole | null;
//# sourceMappingURL=invite.d.ts.map