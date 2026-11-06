import { z } from "zod";
import { frameRejectionSchema, frameSchema, sealedFrameSchema } from "./frame.js";
import { deviceIdSchema, workspaceIdSchema } from "./ids.js";
import { inviteRecordSchema, inviteRejectionSchema } from "./invite.js";
import { roleRecordSchema, roleRejectionSchema } from "./roleRecord.js";
import { memberRoleSchema } from "./roles.js";

/**
 * What a host and a client say to each other.
 *
 * The host is a mailbox: it accepts frames, numbers them, and hands out the ones a
 * client has not seen. Nothing in this protocol asks it to understand a document, and
 * nothing lets it answer a question about one.
 */
export const RELAY_PROTOCOL_VERSION = 2;

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
  sealedSchema,
  sinceSchema,
]);

export type RelayClientMessage = z.infer<typeof relayClientMessageSchema>;

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
    /** A frame the host would not store, or a role record it would not apply. */
    reason: z.union([frameRejectionSchema, roleRejectionSchema, inviteRejectionSchema]),
  })
  .strict();

export const relayErrorCodeSchema = z.enum([
  "protocol-version",
  "not-joined",
  "malformed",
  "unknown",
]);

export type RelayErrorCode = z.infer<typeof relayErrorCodeSchema>;

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
  invitedSchema,
  waitingSchema,
  frameOutSchema,
  refusedSchema,
  errorSchema,
]);

export type RelayHostMessage = z.infer<typeof relayHostMessageSchema>;
export type RelayJoined = z.infer<typeof joinedSchema>;
export type RelayApplied = z.infer<typeof appliedSchema>;
export type RelayWaiting = z.infer<typeof waitingSchema>;
export type RelayMember = z.infer<typeof memberSchema>;
export type RelayFrame = z.infer<typeof frameOutSchema>;

export function encodeRelayMessage(message: RelayClientMessage | RelayHostMessage): string {
  return JSON.stringify(message);
}

export function parseClientMessage(value: unknown): RelayClientMessage | null {
  const parsed = relayClientMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseHostMessage(value: unknown): RelayHostMessage | null {
  const parsed = relayHostMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Whether a client may speak to this host at all. */
export function isRelayCompatible(version: number): boolean {
  return version === RELAY_PROTOCOL_VERSION;
}
