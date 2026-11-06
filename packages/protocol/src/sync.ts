import { z } from "zod";
import { deviceIdSchema, memberIdSchema, workspaceIdSchema } from "./ids.js";

/**
 * A version vector names each Loro peer and the highest counter this side has
 * seen. Two peers exchange vectors, then each sends the updates the other is
 * missing. `update` payloads are opaque bytes here: the protocol does not know
 * what a Loro update contains.
 */
export const versionVectorSchema = z.record(z.string().min(1), z.number().int().nonnegative());

export type VersionVector = z.infer<typeof versionVectorSchema>;

export const syncHelloSchema = z
  .object({
    type: z.literal("hello"),
    protocolVersion: z.number().int().positive(),
    workspaceId: workspaceIdSchema,
    memberId: memberIdSchema,
    deviceId: deviceIdSchema,
    epoch: z.number().int().positive(),
    versionVector: versionVectorSchema,
  })
  .strict();

export const syncUpdateSchema = z
  .object({
    type: z.literal("update"),
    workspaceId: workspaceIdSchema,
    from: deviceIdSchema,
    to: deviceIdSchema,
    epoch: z.number().int().positive(),
    /** Base64 of the opaque Loro update. */
    payload: z.string().min(1),
  })
  .strict();

export const syncAckSchema = z
  .object({
    type: z.literal("ack"),
    epoch: z.number().int().positive(),
    versionVector: versionVectorSchema,
  })
  .strict();

export const syncErrorCodeSchema = z.enum([
  "protocol-version",
  "unauthorized",
  "forbidden",
  "epoch-mismatch",
  "malformed",
  "busy",
  "unknown",
]);

export type SyncErrorCode = z.infer<typeof syncErrorCodeSchema>;

export const syncErrorSchema = z
  .object({
    type: z.literal("error"),
    code: syncErrorCodeSchema,
    message: z.string().min(1).max(500),
  })
  .strict();

export const syncMessageSchema = z.discriminatedUnion("type", [
  syncHelloSchema,
  syncUpdateSchema,
  syncAckSchema,
  syncErrorSchema,
]);

export type SyncHello = z.infer<typeof syncHelloSchema>;
export type SyncUpdate = z.infer<typeof syncUpdateSchema>;
export type SyncAck = z.infer<typeof syncAckSchema>;
export type SyncError = z.infer<typeof syncErrorSchema>;
export type SyncMessage = z.infer<typeof syncMessageSchema>;

export type SyncParse =
  | { readonly ok: true; readonly value: SyncMessage }
  | { readonly ok: false; readonly issues: readonly string[] };

export function parseSyncMessage(value: unknown): SyncParse {
  const parsed = syncMessageSchema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => {
      const path = issue.path.map(String).join(".");
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    }),
  };
}

export function encodeSyncMessage(message: SyncMessage): string {
  return JSON.stringify(message);
}

export function decodeSyncMessage(text: string): SyncParse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, issues: ["the message is not JSON"] };
  }
  return parseSyncMessage(value);
}

export function emptyVersionVector(): VersionVector {
  return {};
}

export function cloneVersionVector(version: VersionVector): VersionVector {
  return { ...version };
}

export function mergeVersionVector(left: VersionVector, right: VersionVector): VersionVector {
  const merged: VersionVector = { ...left };
  for (const [peer, counter] of Object.entries(right)) {
    merged[peer] = Math.max(merged[peer] ?? 0, counter);
  }
  return merged;
}

/** The entries of `target` that `current` has not seen. */
export function diffVersionVector(target: VersionVector, current: VersionVector): VersionVector {
  const missing: VersionVector = {};
  for (const [peer, counter] of Object.entries(target)) {
    if (counter > (current[peer] ?? 0)) missing[peer] = counter;
  }
  return missing;
}

export function isVersionVectorEmpty(version: VersionVector): boolean {
  return Object.keys(version).length === 0;
}

/** True when `left` has seen everything `right` has. */
export function coversVersionVector(left: VersionVector, right: VersionVector): boolean {
  for (const [peer, counter] of Object.entries(right)) {
    if ((left[peer] ?? 0) < counter) return false;
  }
  return true;
}

export function versionVectorEquals(left: VersionVector, right: VersionVector): boolean {
  return coversVersionVector(left, right) && coversVersionVector(right, left);
}
