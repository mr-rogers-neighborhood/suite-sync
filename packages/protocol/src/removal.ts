import { z } from "zod";
import { canonicalJson } from "./canonical.js";
import { deviceIdSchema, workspaceIdSchema } from "./ids.js";

/**
 * A device an owner has taken out of a workspace.
 *
 * The commitment that removes it from the group is ciphertext, and the host cannot read one,
 * so the host would otherwise keep forwarding a removed device's mail and pinning its key for
 * ever. This record is the host's half of the same decision: public metadata — which device,
 * when, and who said so — signed by an owner, stored beside the role records.
 *
 * It is not a revocation of the device's keys and it cannot be. The device still holds
 * whatever it already had; what it loses is every frame sealed after the epoch it was removed
 * in. That is the honest shape of forward secrecy, and the app says so with one sentence
 * rather than pretending the copy is gone.
 */
export const removalRecordSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    /** The device being taken out. */
    deviceId: deviceIdSchema,
    /** ISO-8601, written by the owner. */
    removedAt: z.string().min(1),
    /** The owner's device. */
    signerId: deviceIdSchema,
    signature: z.string().min(1),
  })
  .strict();

export type RemovalRecord = z.infer<typeof removalRecordSchema>;

export interface RemovalState {
  readonly workspaceId: string;
  /** Device id to the moment it was removed. */
  readonly removed: Readonly<Record<string, string>>;
}

export const removalRejectionSchema = z.enum([
  "wrong-workspace",
  "invalid-signature",
  "not-owner",
  /** An owner cannot remove itself: that is how a workspace ends up owned by nobody. */
  "self",
]);

export type RemovalRejection = z.infer<typeof removalRejectionSchema>;

export type RemovalResult =
  | { readonly ok: true; readonly state: RemovalState }
  | { readonly ok: false; readonly reason: RemovalRejection };

export type RemovalVerifier = (payload: string, signature: string, signerId: string) => boolean;

export function createRemovalState(workspaceId: string): RemovalState {
  return { workspaceId, removed: {} };
}

export function removalRecordPayload(
  record: Pick<RemovalRecord, "workspaceId" | "deviceId" | "removedAt" | "signerId">,
): string {
  return canonicalJson({
    workspaceId: record.workspaceId,
    deviceId: record.deviceId,
    removedAt: record.removedAt,
    signerId: record.signerId,
  });
}

/**
 * Take a device out, if an owner said so.
 *
 * `isOwner` is asked rather than inferred, exactly as with an invitation: roles live in the
 * role records and this module does not need to know how they got there.
 */
export function applyRemovalRecord(
  state: RemovalState,
  record: RemovalRecord,
  verify: RemovalVerifier,
  isOwner: (deviceId: string) => boolean,
): RemovalResult {
  if (record.workspaceId !== state.workspaceId) return { ok: false, reason: "wrong-workspace" };
  if (!isOwner(record.signerId)) return { ok: false, reason: "not-owner" };
  if (record.signerId === record.deviceId) return { ok: false, reason: "self" };
  if (!verify(removalRecordPayload(record), record.signature, record.signerId)) {
    return { ok: false, reason: "invalid-signature" };
  }

  return {
    ok: true,
    state: { ...state, removed: { ...state.removed, [record.deviceId]: record.removedAt } },
  };
}

export function isRemoved(state: RemovalState, deviceId: string): boolean {
  return state.removed[deviceId] !== undefined;
}

/**
 * Let a removed device back in.
 *
 * An owner minting a fresh invitation is the permission, so spending one is what clears the
 * mark. Without this a device that was removed could never come back, which would make
 * "remove" a one-way door nobody asked for.
 */
export function reinstateDevice(state: RemovalState, deviceId: string): RemovalState {
  if (state.removed[deviceId] === undefined) return state;
  const { [deviceId]: _forgotten, ...rest } = state.removed;
  return { ...state, removed: rest };
}
