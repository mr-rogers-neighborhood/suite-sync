import { z } from "zod";
import { frameRejectionSchema, frameSchema, sealedFrameSchema } from "./frame.js";
import { deviceIdSchema, workspaceIdSchema } from "./ids.js";
import { roleRecordSchema, roleRejectionSchema } from "./roleRecord.js";
/**
 * What a host and a client say to each other.
 *
 * The host is a mailbox: it accepts frames, numbers them, and hands out the ones a
 * client has not seen. Nothing in this protocol asks it to understand a document, and
 * nothing lets it answer a question about one.
 */
export const RELAY_PROTOCOL_VERSION = 1;
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
})
    .strict();
/** A role record, so the host can refuse a viewer without reading anything. */
const roleSchema = z.object({ type: z.literal("role"), record: roleRecordSchema }).strict();
/** One sealed frame, on its way to the store and everybody else. */
const sealedSchema = z.object({ type: z.literal("frame"), frame: sealedFrameSchema }).strict();
/** Everything after the index a client already has. `0` means everything. */
const sinceSchema = z
    .object({ type: z.literal("since"), after: z.number().int().nonnegative() })
    .strict();
export const relayClientMessageSchema = z.discriminatedUnion("type", [
    joinSchema,
    roleSchema,
    sealedSchema,
    sinceSchema,
]);
const joinedSchema = z
    .object({
    type: z.literal("joined"),
    protocolVersion: z.number().int().positive(),
    workspaceId: workspaceIdSchema,
    /** The newest epoch the host has stored, or null for a workspace it has never seen. */
    newestEpoch: z.number().int().nonnegative().nullable(),
    /** How many frames it holds, so a client knows whether to ask for a catch-up. */
    frames: z.number().int().nonnegative(),
})
    .strict();
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
const refusedSchema = z
    .object({
    type: z.literal("refused"),
    /** A frame the host would not store, or a role record it would not apply. */
    reason: z.union([frameRejectionSchema, roleRejectionSchema]),
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
export const relayHostMessageSchema = z.discriminatedUnion("type", [
    joinedSchema,
    appliedSchema,
    frameOutSchema,
    refusedSchema,
    errorSchema,
]);
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