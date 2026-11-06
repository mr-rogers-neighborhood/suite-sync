import { z } from "zod";
import { type MemberRole } from "./roles.js";
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
export declare const roleRecordSchema: z.ZodObject<{
    workspaceId: z.ZodString;
    deviceId: z.ZodString;
    role: z.ZodEnum<{
        owner: "owner";
        editor: "editor";
        viewer: "viewer";
    }>;
    seq: z.ZodNumber;
    signerId: z.ZodString;
    signature: z.ZodString;
}, z.core.$strict>;
export type RoleRecord = z.infer<typeof roleRecordSchema>;
export interface RoleState {
    readonly workspaceId: string;
    readonly lastSeq: Readonly<Record<string, number>>;
    readonly roles: Readonly<Record<string, MemberRole>>;
}
export declare const roleRejectionSchema: z.ZodEnum<{
    "wrong-workspace": "wrong-workspace";
    "invalid-signature": "invalid-signature";
    "not-owner": "not-owner";
    "wrong-seq": "wrong-seq";
    "last-owner": "last-owner";
    "role-unchanged": "role-unchanged";
}>;
export type RoleRejection = "wrong-workspace" | "invalid-signature" | "wrong-seq" | "not-owner" | "last-owner" | "role-unchanged";
export type RoleResult = {
    readonly ok: true;
    readonly state: RoleState;
} | {
    readonly ok: false;
    readonly reason: RoleRejection;
};
/** Verifies a record's signature against the signer's device key. */
export type RoleVerifier = (payload: string, signature: string, signerId: string) => boolean;
export declare function createRoleState(workspaceId: string): RoleState;
/** The bytes a signer signs. The signature is excluded, so this runs before and after. */
export declare function roleRecordPayload(record: Pick<RoleRecord, "workspaceId" | "deviceId" | "role" | "seq" | "signerId">): string;
/**
 * Apply one record.
 *
 * The first record in an empty workspace is the device claiming ownership of itself.
 * Everything after it needs an owner's signature. A device's own role is otherwise
 * changed only by an owner, and the last owner cannot be demoted — a workspace whose
 * owner list reaches zero can never be changed again.
 */
export declare function applyRoleRecord(state: RoleState, record: RoleRecord, verify: RoleVerifier): RoleResult;
export declare function applyRoleRecords(state: RoleState, records: readonly RoleRecord[], verify: RoleVerifier): RoleResult;
export declare function roleOfDevice(state: RoleState, deviceId: string): MemberRole | null;
export declare function ownerDevices(state: RoleState): readonly string[];
/**
 * Whether the host should store this device's frame.
 *
 * A device with no record yet cannot write: membership arrives first (the MLS Add) and
 * the role record second, so a frame that beats its own role is a sender that was not
 * authorised when it wrote.
 */
export declare function mayWrite(state: RoleState, deviceId: string): boolean;
//# sourceMappingURL=roleRecord.d.ts.map