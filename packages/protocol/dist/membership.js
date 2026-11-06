import { z } from "zod";
import { canonicalJson } from "./canonical.js";
import { inviteIdSchema, memberIdSchema, workspaceIdSchema } from "./ids.js";
import { canInvite, memberRoleSchema } from "./roles.js";
const displayNameSchema = z.string().trim().min(1).max(80);
const keySchema = z.string().min(1).max(4096);
const signatureSchema = z.string().min(1).max(4096);
/**
 * The membership log is append-only and signed. Each entry is one transition:
 * create the workspace, invite a member, accept an invite, change a role or
 * revoke a member.
 *
 * An invite names the invitee's public key, so accepting it is a signature by
 * the key the owner meant to invite, not a bearer token that anyone can use.
 */
export const membershipActionSchema = z.discriminatedUnion("type", [
    z
        .object({
        type: z.literal("create"),
        ownerPublicKey: keySchema,
        displayName: displayNameSchema,
    })
        .strict(),
    z
        .object({
        type: z.literal("invite"),
        inviteId: inviteIdSchema,
        memberId: memberIdSchema,
        publicKey: keySchema,
        displayName: displayNameSchema,
        role: z.enum(["editor", "viewer"]),
        expiresAt: z.iso.datetime(),
    })
        .strict(),
    z
        .object({
        type: z.literal("accept"),
        inviteId: inviteIdSchema,
    })
        .strict(),
    z
        .object({
        type: z.literal("set-role"),
        memberId: memberIdSchema,
        role: z.enum(["editor", "viewer"]),
    })
        .strict(),
    z
        .object({
        type: z.literal("revoke"),
        memberId: memberIdSchema,
    })
        .strict(),
]);
export const membershipEntrySchema = z
    .object({
    seq: z.number().int().nonnegative(),
    workspaceId: workspaceIdSchema,
    actorId: memberIdSchema,
    createdAt: z.iso.datetime(),
    action: membershipActionSchema,
    signature: signatureSchema,
})
    .strict();
export const memberRecordSchema = z
    .object({
    memberId: memberIdSchema,
    displayName: displayNameSchema,
    publicKey: keySchema,
    role: memberRoleSchema,
    status: z.enum(["active", "revoked"]),
    joinedAt: z.iso.datetime(),
    epoch: z.number().int().positive(),
})
    .strict();
export const inviteRecordSchema = z
    .object({
    inviteId: inviteIdSchema,
    memberId: memberIdSchema,
    publicKey: keySchema,
    displayName: displayNameSchema,
    role: memberRoleSchema,
    expiresAt: z.iso.datetime(),
    status: z.enum(["pending", "accepted", "revoked", "expired"]),
})
    .strict();
/**
 * A serialized membership state.
 *
 * This is a Phase 2 admin shape: the operator writes it beside a snapshot. The
 * signed log in `membershipEntrySchema` is the source of truth; this state is
 * what a replay produces and what the server loads before the invite flow lands.
 */
export const membershipStateSchema = z
    .object({
    workspaceId: workspaceIdSchema,
    epoch: z.number().int().positive(),
    lastSeq: z.number().int().nonnegative(),
    members: z.record(memberIdSchema, memberRecordSchema),
    invites: z.record(inviteIdSchema, inviteRecordSchema),
})
    .strict();
export function parseMembershipState(value) {
    const parsed = membershipStateSchema.safeParse(value);
    if (parsed.success)
        return { ok: true, value: parsed.data };
    return {
        ok: false,
        issues: parsed.error.issues.map((issue) => {
            const path = issue.path.map(String).join(".");
            return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
        }),
    };
}
/** A workspace with no membership yet. The first entry must be `create`. */
export function createMembershipState(workspaceId) {
    return {
        workspaceId,
        epoch: 1,
        lastSeq: 0,
        members: {},
        invites: {},
    };
}
/**
 * The bytes a signer signs. The signature is excluded so the same function can
 * be used before and after signing.
 */
export function membershipEntryPayload(entry) {
    return canonicalJson({
        seq: entry.seq,
        workspaceId: entry.workspaceId,
        actorId: entry.actorId,
        createdAt: entry.createdAt,
        action: entry.action,
    });
}
export function parseMembershipEntry(value) {
    const parsed = membershipEntrySchema.safeParse(value);
    if (parsed.success)
        return { ok: true, value: parsed.data };
    return {
        ok: false,
        issues: parsed.error.issues.map((issue) => {
            const path = issue.path.map(String).join(".");
            return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
        }),
    };
}
export function applyMembershipEntries(state, entries, verify, now = new Date().toISOString()) {
    let current = state;
    for (const entry of entries) {
        const result = applyMembershipEntry(current, entry, verify, now);
        if (!result.ok)
            return result;
        current = result.state;
    }
    return { ok: true, state: current };
}
export function applyMembershipEntry(state, entry, verify, now = new Date().toISOString()) {
    if (entry.workspaceId !== state.workspaceId)
        return fail("wrong-workspace");
    if (entry.seq !== state.lastSeq + 1)
        return fail("wrong-seq");
    const action = entry.action;
    switch (action.type) {
        case "create":
            return applyCreate(state, entry, action, verify);
        case "invite":
            return applyInvite(state, entry, action, verify, now);
        case "accept":
            return applyAccept(state, entry, action, verify, now);
        case "set-role":
            return applySetRole(state, entry, action, verify);
        case "revoke":
            return applyRevoke(state, entry, action, verify);
    }
}
function applyCreate(state, entry, action, verify) {
    if (state.lastSeq !== 0 || Object.keys(state.members).length > 0) {
        return fail("already-initialised");
    }
    if (state.members[entry.actorId] !== undefined)
        return fail("member-exists");
    if (!verify(entry, action.ownerPublicKey))
        return fail("invalid-signature");
    const owner = {
        memberId: entry.actorId,
        displayName: action.displayName,
        publicKey: action.ownerPublicKey,
        role: "owner",
        status: "active",
        joinedAt: entry.createdAt,
        epoch: state.epoch,
    };
    return ok({
        ...state,
        lastSeq: entry.seq,
        members: { ...state.members, [owner.memberId]: owner },
    });
}
function applyInvite(state, entry, action, verify, now) {
    const actor = activeMember(state, entry.actorId);
    if (actor === null)
        return fail("not-member");
    if (!canInvite(actor.role))
        return fail("not-owner");
    if (!verify(entry, actor.publicKey))
        return fail("invalid-signature");
    const existing = state.members[action.memberId];
    if (existing?.status === "active")
        return fail("member-active");
    const pending = Object.values(state.invites).some((invite) => invite.memberId === action.memberId && invite.status === "pending");
    if (pending || state.invites[action.inviteId] !== undefined)
        return fail("invite-exists");
    if (Date.parse(action.expiresAt) <= Date.parse(now))
        return fail("invite-expired");
    const invite = {
        inviteId: action.inviteId,
        memberId: action.memberId,
        publicKey: action.publicKey,
        displayName: action.displayName,
        role: action.role,
        expiresAt: action.expiresAt,
        status: "pending",
    };
    return ok({
        ...state,
        lastSeq: entry.seq,
        invites: { ...state.invites, [invite.inviteId]: invite },
    });
}
function applyAccept(state, entry, action, verify, now) {
    const invite = state.invites[action.inviteId];
    if (invite === undefined)
        return fail("unknown-invite");
    if (invite.status !== "pending")
        return fail("invite-not-pending");
    if (entry.actorId !== invite.memberId)
        return fail("invite-not-yours");
    if (Date.parse(invite.expiresAt) <= Date.parse(now))
        return fail("invite-expired");
    if (!verify(entry, invite.publicKey))
        return fail("invalid-signature");
    const existing = state.members[invite.memberId];
    if (existing?.status === "active")
        return fail("member-active");
    const member = {
        memberId: invite.memberId,
        displayName: invite.displayName,
        publicKey: invite.publicKey,
        role: invite.role,
        status: "active",
        joinedAt: entry.createdAt,
        epoch: state.epoch,
    };
    return ok({
        ...state,
        lastSeq: entry.seq,
        members: { ...state.members, [member.memberId]: member },
        invites: {
            ...state.invites,
            [invite.inviteId]: { ...invite, status: "accepted" },
        },
    });
}
function applySetRole(state, entry, action, verify) {
    const actor = activeMember(state, entry.actorId);
    if (actor === null)
        return fail("not-member");
    if (!canInvite(actor.role))
        return fail("not-owner");
    if (!verify(entry, actor.publicKey))
        return fail("invalid-signature");
    const target = state.members[action.memberId];
    if (target === undefined)
        return fail("not-member");
    if (target.status !== "active")
        return fail("member-inactive");
    if (target.role === "owner")
        return fail("owner-cannot-be-demoted");
    if (target.role === action.role)
        return fail("role-unchanged");
    return ok({
        ...state,
        lastSeq: entry.seq,
        members: {
            ...state.members,
            [target.memberId]: { ...target, role: action.role },
        },
    });
}
function applyRevoke(state, entry, action, verify) {
    const actor = activeMember(state, entry.actorId);
    if (actor === null)
        return fail("not-member");
    if (!canInvite(actor.role))
        return fail("not-owner");
    if (!verify(entry, actor.publicKey))
        return fail("invalid-signature");
    if (action.memberId === entry.actorId)
        return fail("self-revoke");
    const target = state.members[action.memberId];
    if (target === undefined)
        return fail("not-member");
    if (target.status !== "active")
        return fail("member-inactive");
    if (target.role === "owner")
        return fail("owner-cannot-be-revoked");
    const invites = Object.fromEntries(Object.entries(state.invites).map(([inviteId, invite]) => [
        inviteId,
        invite.memberId === target.memberId && invite.status === "pending"
            ? { ...invite, status: "revoked" }
            : invite,
    ]));
    return ok({
        ...state,
        lastSeq: entry.seq,
        epoch: state.epoch + 1,
        members: {
            ...state.members,
            [target.memberId]: { ...target, status: "revoked" },
        },
        invites,
    });
}
function activeMember(state, memberId) {
    const member = state.members[memberId];
    return member !== undefined && member.status === "active" ? member : null;
}
export function ownerIds(state) {
    return Object.values(state.members)
        .filter((member) => member.status === "active" && member.role === "owner")
        .map((member) => member.memberId);
}
export function activeMembers(state) {
    return Object.values(state.members).filter((member) => member.status === "active");
}
export function roleOf(state, memberId) {
    return activeMember(state, memberId)?.role ?? null;
}
export function describeMembershipRejection(reason) {
    switch (reason) {
        case "wrong-workspace":
            return "That entry belongs to a different workspace.";
        case "wrong-seq":
            return "That entry is out of order.";
        case "invalid-signature":
            return "That entry was not signed by the member it names.";
        case "already-initialised":
            return "This workspace already has an owner.";
        case "not-member":
            return "That member is not in this workspace.";
        case "member-inactive":
            return "That member is not active.";
        case "member-active":
            return "That member is already active.";
        case "member-exists":
            return "That member already exists.";
        case "not-owner":
            return "Only the owner can do that.";
        case "invite-exists":
            return "An invite for that member is already pending.";
        case "unknown-invite":
            return "That invite does not exist.";
        case "invite-not-pending":
            return "That invite was already used or revoked.";
        case "invite-not-yours":
            return "That invite belongs to a different member.";
        case "invite-expired":
            return "That invite has expired.";
        case "owner-cannot-be-demoted":
            return "The owner cannot be demoted in this version.";
        case "owner-cannot-be-revoked":
            return "The owner cannot be revoked in this version.";
        case "role-unchanged":
            return "That member already has that role.";
        case "self-revoke":
            return "The owner cannot revoke their own membership.";
    }
}
function ok(state) {
    return { ok: true, state };
}
function fail(reason) {
    return { ok: false, reason };
}
//# sourceMappingURL=membership.js.map