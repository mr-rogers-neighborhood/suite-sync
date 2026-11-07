import { z } from "zod";
import { frameRejectionSchema, frameSchema, sealedFrameSchema } from "./frame.js";
import { deviceIdSchema, workspaceIdSchema } from "./ids.js";
import { inviteRecordSchema, inviteRejectionSchema } from "./invite.js";
import { removalRecordSchema, removalRejectionSchema } from "./removal.js";
import { roleRecordSchema, roleRejectionSchema } from "./roleRecord.js";
import { memberRoleSchema } from "./roles.js";
/**
 * What a host and a client say to each other.
 *
 * The host is a mailbox: it accepts frames, numbers them, and hands out the ones a
 * client has not seen. Nothing in this protocol asks it to understand a document, and
 * nothing lets it answer a question about one.
 */
/**
 * 3: a device may say something the host is asked to forget, and an owner may take a device
 * out of a workspace.
 */
export const RELAY_PROTOCOL_VERSION = 3;
/**
 * A client announces itself.
 *
 * The device id is who it claims to be, and `publicKey` is what it will prove it with: the
 * host pins the key the first time it sees a device and checks every frame and role record
 * against that key afterwards. Pinning is not a claim that the device is trustworthy —
 * membership in the MLS group is — it is what lets the host tell one device from another.
 */
const joinSchema = z
    .object({
    type: z.literal("join"),
    protocolVersion: z.number().int().positive(),
    workspaceId: workspaceIdSchema,
    deviceId: deviceIdSchema,
    /** Base64 of the device's Ed25519 public key. */
    publicKey: z.string().min(1),
    /**
     * What to call this device in an interface.
     *
     * Carried because a person cannot tell two fingerprints apart, and every decision they are
     * asked to make about a device — let it in, remove it — is a decision about which one.
     */
    name: z.string().min(1).max(80),
    /**
     * The invitation this device is holding, when it is holding one.
     *
     * Normally the host learns this from the key package. It is here so a device that an owner
     * has taken out can say "I have been asked back" at the door, rather than being told it is
     * removed and having no way to explain itself.
     */
    inviteId: z.string().min(1).optional(),
})
    .strict();
/** An invite an owner wrote. The host keeps it and asks nothing else about it. */
const inviteSchema = z.object({ type: z.literal("invite"), record: inviteRecordSchema }).strict();
/**
 * A key package from a device that has no role yet.
 *
 * It carries the device id and key the frame is signed with, because the host has to pin
 * them before it can check the signature — and this is the only message a device sends
 * before it is a member.
 */
const keyPackageSchema = z
    .object({
    type: z.literal("keypackage"),
    inviteId: z.string().min(1),
    deviceId: deviceIdSchema,
    publicKey: z.string().min(1),
    name: z.string().min(1).max(80),
    frame: sealedFrameSchema,
})
    .strict();
/** A role record, so the host can refuse a viewer without reading anything. */
const roleSchema = z.object({ type: z.literal("role"), record: roleRecordSchema }).strict();
/**
 * A message that is forwarded and forgotten.
 *
 * Presence is the only thing a person sends that nobody should keep: a cursor in the log would
 * be a document that grows every time somebody moves. So this is verified and relayed, and it
 * is never numbered, appended or written down. The host still checks who sent it — a stranger
 * may not use the host as a megaphone — but the check is membership, not permission to write.
 *
 * It is deliberately not a frame. A frame carries the group's application ciphertext, which
 * ratchets per message: one dropped cursor would leave a gap in the secret tree that the next
 * *document* update had to work around. Presence is encrypted with a key derived from the
 * group instead (see `ephemeralKey`), so it can be late, out of order, or absent without ever
 * costing the thing it is merely describing.
 */
const ephemeralSchema = z
    .object({
    type: z.literal("ephemeral"),
    workspaceId: workspaceIdSchema,
    deviceId: deviceIdSchema,
    /** Base64 of this device's sealed presence bytes. */
    payload: z.string().min(1),
    signature: z.string().min(1),
})
    .strict();
/** An owner taking a device out. Public metadata, signed, kept beside the role records. */
const removalSchema = z
    .object({ type: z.literal("removal"), record: removalRecordSchema })
    .strict();
/** One sealed frame, on its way to the store and everybody else. */
const sealedSchema = z.object({ type: z.literal("frame"), frame: sealedFrameSchema }).strict();
/** Everything after the index a client already has. `0` means everything. */
const sinceSchema = z
    .object({ type: z.literal("since"), after: z.number().int().nonnegative() })
    .strict();
export const relayClientMessageSchema = z.discriminatedUnion("type", [
    joinSchema,
    inviteSchema,
    keyPackageSchema,
    roleSchema,
    ephemeralSchema,
    removalSchema,
    sealedSchema,
    sinceSchema,
]);
/**
 * One device the host will accept a frame from, as the host already knows it: the name it
 * gave on the way in and the role it was granted.
 *
 * The host is not reading anything to produce this. It admits frames by role and pins a key
 * per device, so it holds exactly these three fields and is telling members what it must
 * already know to do its job.
 */
const memberSchema = z
    .object({
    deviceId: deviceIdSchema,
    name: z.string().min(1).max(80),
    role: memberRoleSchema,
})
    .strict();
const joinedSchema = z
    .object({
    type: z.literal("joined"),
    protocolVersion: z.number().int().positive(),
    workspaceId: workspaceIdSchema,
    /** The newest epoch the host has stored, or null for a workspace it has never seen. */
    newestEpoch: z.number().int().nonnegative().nullable(),
    /** How many frames it holds, so a client knows whether to ask for a catch-up. */
    frames: z.number().int().nonnegative(),
    /**
     * Who is in the workspace and what each of them may do.
     *
     * A device is told who its neighbours are, because every decision a person is asked to
     * make here — hand this on, remove that one — is a decision about a named device. The
     * exchange is metadata only: not one byte of anyone's document is involved.
     */
    members: z.array(memberSchema),
})
    .strict();
/** A forwarded presence message. Not numbered, because nothing keeps it. */
const ephemeralOutSchema = z
    .object({
    type: z.literal("ephemeral"),
    workspaceId: workspaceIdSchema,
    deviceId: deviceIdSchema,
    payload: z.string().min(1),
    signature: z.string().min(1),
})
    .strict();
/**
 * The one sentence a removed device is owed.
 *
 * Its socket is about to close, and "the host is not answering" is the wrong answer: the app
 * would offer to retry something that can never work, and the person would keep trying.
 */
const removedSchema = z.object({ type: z.literal("removed") }).strict();
/** A frame with its position, so a client can ask for what comes after it. */
const frameOutSchema = z
    .object({
    type: z.literal("frame"),
    index: z.number().int().nonnegative(),
    frame: frameSchema,
})
    .strict();
/**
 * A role record the host applied, echoed to the device that sent it.
 *
 * Without this a client cannot tell whether its role landed, and an app has to know it is
 * an owner before it offers to invite anything.
 */
const appliedSchema = z
    .object({
    type: z.literal("applied"),
    deviceId: deviceIdSchema,
    role: z.enum(["owner", "editor", "viewer"]),
    seq: z.number().int().nonnegative(),
})
    .strict();
/** An invite the host accepted, echoed to the owner so it knows the code is live. */
const invitedSchema = z
    .object({ type: z.literal("invited"), inviteId: z.string().min(1) })
    .strict();
/**
 * A device is waiting to be let in, and this is the invitation it spent.
 *
 * An owner has to write the joiner's role record, and the role was decided by whoever wrote
 * the invitation — which need not be the device doing the admitting, so it cannot be looked
 * up locally. The host read the invitation to decide whether to honour it, so it is the one
 * party that can answer. The invitation is already spent by the time this is sent.
 */
const waitingSchema = z
    .object({
    type: z.literal("waiting"),
    deviceId: deviceIdSchema,
    name: z.string().min(1).max(80),
    inviteId: z.string().min(1),
    role: memberRoleSchema,
})
    .strict();
const refusedSchema = z
    .object({
    type: z.literal("refused"),
    /** A frame the host would not store, or a record it would not apply. */
    reason: z.union([
        frameRejectionSchema,
        roleRejectionSchema,
        inviteRejectionSchema,
        removalRejectionSchema,
    ]),
})
    .strict();
export const relayErrorCodeSchema = z.enum([
    "protocol-version",
    "not-joined",
    "malformed",
    "unknown",
]);
const errorSchema = z
    .object({
    type: z.literal("error"),
    code: relayErrorCodeSchema,
    message: z.string(),
})
    .strict();
/**
 * Who is in the workspace now.
 *
 * Sent to every socket in the room whenever a role record is applied, so a device's view of
 * its neighbours does not depend on when it happened to join. `joined` carries the same list
 * for the moment of joining; this is what keeps it true afterwards.
 */
const rosterSchema = z
    .object({ type: z.literal("roster"), members: z.array(memberSchema) })
    .strict();
export const relayHostMessageSchema = z.discriminatedUnion("type", [
    joinedSchema,
    appliedSchema,
    invitedSchema,
    waitingSchema,
    rosterSchema,
    ephemeralOutSchema,
    removedSchema,
    frameOutSchema,
    refusedSchema,
    errorSchema,
]);
/**
 * The bytes a device signs for a presence message.
 *
 * The host checks this before forwarding, because otherwise any socket could speak as any
 * device and a workspace's "who is here" would be whatever a passer-by said it was.
 */
export function ephemeralPayload(message) {
    return new TextEncoder().encode(["ephemeral", message.workspaceId, message.deviceId, message.payload].join("\n"));
}
export function encodeRelayMessage(message) {
    return JSON.stringify(message);
}
export function parseClientMessage(value) {
    const parsed = relayClientMessageSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}
export function parseHostMessage(value) {
    const parsed = relayHostMessageSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}
/** Whether a client may speak to this host at all. */
export function isRelayCompatible(version) {
    return version === RELAY_PROTOCOL_VERSION;
}
//# sourceMappingURL=relay.js.map