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

/** A client announces itself. The device id is who it claims to be; its frames prove it. */
const joinSchema = z
  .object({
    type: z.literal("join"),
    protocolVersion: z.number().int().positive(),
    workspaceId: workspaceIdSchema,
    deviceId: deviceIdSchema,
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

export type RelayClientMessage = z.infer<typeof relayClientMessageSchema>;

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
  frameOutSchema,
  refusedSchema,
  errorSchema,
]);

export type RelayHostMessage = z.infer<typeof relayHostMessageSchema>;
export type RelayJoined = z.infer<typeof joinedSchema>;
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
