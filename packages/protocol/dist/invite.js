import { z } from "zod";
import { canonicalJson } from "./canonical.js";
import { deviceIdSchema, inviteIdSchema, workspaceIdSchema } from "./ids.js";
import { memberRoleSchema } from "./roles.js";
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
export const inviteRecordSchema = z
    .object({
    workspaceId: workspaceIdSchema,
    inviteId: inviteIdSchema,
    /** The role the device will hold once an owner lets it in. */
    role: memberRoleSchema,
    /** ISO-8601. An expired invite is refused, and that is the whole revocation story here. */
    expiresAt: z.string().min(1),
    /** The owner's device. */
    signerId: deviceIdSchema,
    signature: z.string().min(1),
})
    .strict();
export const inviteRejectionSchema = z.enum([
    "wrong-workspace",
    "invalid-signature",
    "not-owner",
    "expired",
    "unknown-invite",
    "invite-spent",
]);
export function createInviteState(workspaceId) {
    return { workspaceId, invites: {}, spent: {} };
}
export function inviteRecordPayload(record) {
    return canonicalJson({
        workspaceId: record.workspaceId,
        inviteId: record.inviteId,
        role: record.role,
        expiresAt: record.expiresAt,
        signerId: record.signerId,
    });
}
/**
 * Record an invite, if an owner wrote it and it has not already expired.
 *
 * `isOwner` is asked rather than inferred: membership lives in MLS and roles live in the
 * role records, and this module does not need to know which.
 */
export function addInvite(state, record, verify, isOwner, now = new Date()) {
    if (record.workspaceId !== state.workspaceId)
        return { ok: false, reason: "wrong-workspace" };
    // Ownership first: a device that is not in the workspace cannot invite whatever it signed,
    // and "not an owner" is a truer answer than "bad signature" for a device nobody has met.
    if (!isOwner(record.signerId))
        return { ok: false, reason: "not-owner" };
    if (!verify(inviteRecordPayload(record), record.signature, record.signerId)) {
        return { ok: false, reason: "invalid-signature" };
    }
    if (record.expiresAt <= now.toISOString())
        return { ok: false, reason: "expired" };
    return {
        ok: true,
        state: {
            ...state,
            invites: { ...state.invites, [record.inviteId]: record },
        },
    };
}
/**
 * The invite a joining device may use, or why it may not.
 *
 * Checked on every use rather than at join time only: an invite can expire while a device is
 * waiting in the lobby, and a host that accepted it anyway would be honouring a promise its
 * owner had already withdrawn.
 */
export function liveInvite(state, inviteId, now = new Date()) {
    const record = state.invites[inviteId];
    if (record === undefined)
        return { ok: false, reason: "unknown-invite" };
    if (state.spent[inviteId] === true)
        return { ok: false, reason: "invite-spent" };
    if (record.expiresAt <= now.toISOString())
        return { ok: false, reason: "expired" };
    return { ok: true, record };
}
/** One invite, one device. A second attempt with the same invite is refused. */
export function spendInvite(state, inviteId) {
    return { ...state, spent: { ...state.spent, [inviteId]: true } };
}
/** The role a spent invite grants. */
export function invitedRole(state, inviteId) {
    return state.invites[inviteId]?.role ?? null;
}
//# sourceMappingURL=invite.js.map