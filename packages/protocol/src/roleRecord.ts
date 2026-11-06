import { z } from "zod";
import { canonicalJson } from "./canonical.js";
import { deviceIdSchema, workspaceIdSchema } from "./ids.js";
import { type MemberRole, memberRoleSchema } from "./roles.js";

/**
 * Who may write, kept beside the group rather than inside it.
 *
 * MLS says who is in the group. It has no opinion about who is allowed to edit, and a
 * blind host cannot read a document to find out. So each role is a small signed record:
 * the host checks the signature and the role, and refuses a frame from a viewer without
 * decrypting anything.
 *
 * Records are chained per device by `seq` rather than in one global log, so two owners
 * changing different people's roles cannot collide.
 */
export const roleRecordSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    /** The device whose role this sets. */
    deviceId: deviceIdSchema,
    role: memberRoleSchema,
    /** Monotonic per device: the next record for a device is the last one plus one. */
    seq: z.number().int().nonnegative(),
    /** The device that wrote it. Must be an owner, or the device claiming ownership first. */
    signerId: deviceIdSchema,
    signature: z.string().min(1),
  })
  .strict();

export type RoleRecord = z.infer<typeof roleRecordSchema>;

export interface RoleState {
  readonly workspaceId: string;
  readonly lastSeq: Readonly<Record<string, number>>;
  readonly roles: Readonly<Record<string, MemberRole>>;
}

export type RoleRejection =
  | "wrong-workspace"
  | "invalid-signature"
  | "wrong-seq"
  | "not-owner"
  | "last-owner"
  | "role-unchanged";

export type RoleResult =
  | { readonly ok: true; readonly state: RoleState }
  | { readonly ok: false; readonly reason: RoleRejection };

/** Verifies a record's signature against the signer's device key. */
export type RoleVerifier = (payload: string, signature: string, signerId: string) => boolean;

export function createRoleState(workspaceId: string): RoleState {
  return { workspaceId, lastSeq: {}, roles: {} };
}

/** The bytes a signer signs. The signature is excluded, so this runs before and after. */
export function roleRecordPayload(
  record: Pick<RoleRecord, "workspaceId" | "deviceId" | "role" | "seq" | "signerId">,
): string {
  return canonicalJson({
    workspaceId: record.workspaceId,
    deviceId: record.deviceId,
    role: record.role,
    seq: record.seq,
    signerId: record.signerId,
  });
}

/**
 * Apply one record.
 *
 * The first record in an empty workspace is the device claiming ownership of itself.
 * Everything after it needs an owner's signature. A device's own role is otherwise
 * changed only by an owner, and the last owner cannot be demoted — a workspace whose
 * owner list reaches zero can never be changed again.
 */
export function applyRoleRecord(
  state: RoleState,
  record: RoleRecord,
  verify: RoleVerifier,
): RoleResult {
  if (record.workspaceId !== state.workspaceId) return { ok: false, reason: "wrong-workspace" };

  const payload = roleRecordPayload(record);
  if (!verify(payload, record.signature, record.signerId)) {
    return { ok: false, reason: "invalid-signature" };
  }

  const owners = ownerDevices(state);
  const isFirstRecord = owners.length === 0;
  if (isFirstRecord) {
    const claimsOwnership = record.deviceId === record.signerId && record.role === "owner";
    if (!claimsOwnership) return { ok: false, reason: "not-owner" };
  } else if (!owners.includes(record.signerId)) {
    return { ok: false, reason: "not-owner" };
  }

  const previous = state.lastSeq[record.deviceId] ?? -1;
  if (record.seq !== previous + 1) return { ok: false, reason: "wrong-seq" };

  const current = state.roles[record.deviceId];
  if (current === record.role) return { ok: false, reason: "role-unchanged" };

  const demoting = current === "owner" && record.role !== "owner";
  if (demoting && owners.length === 1) return { ok: false, reason: "last-owner" };

  return {
    ok: true,
    state: {
      workspaceId: state.workspaceId,
      lastSeq: { ...state.lastSeq, [record.deviceId]: record.seq },
      roles: { ...state.roles, [record.deviceId]: record.role },
    },
  };
}

export function applyRoleRecords(
  state: RoleState,
  records: readonly RoleRecord[],
  verify: RoleVerifier,
): RoleResult {
  let current = state;
  for (const record of records) {
    const result = applyRoleRecord(current, record, verify);
    if (!result.ok) return result;
    current = result.state;
  }
  return { ok: true, state: current };
}

export function roleOfDevice(state: RoleState, deviceId: string): MemberRole | null {
  return state.roles[deviceId] ?? null;
}

export function ownerDevices(state: RoleState): readonly string[] {
  return Object.entries(state.roles)
    .filter(([, role]) => role === "owner")
    .map(([deviceId]) => deviceId)
    .sort();
}

/**
 * Whether the host should store this device's frame.
 *
 * A device with no record yet cannot write: membership arrives first (the MLS Add) and
 * the role record second, so a frame that beats its own role is a sender that was not
 * authorised when it wrote.
 */
export function mayWrite(state: RoleState, deviceId: string): boolean {
  const role = roleOfDevice(state, deviceId);
  return role !== null && role !== "viewer";
}
