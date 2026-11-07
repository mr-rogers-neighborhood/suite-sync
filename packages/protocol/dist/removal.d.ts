import { z } from "zod";
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
export declare const removalRecordSchema: z.ZodObject<{
    workspaceId: z.ZodString;
    deviceId: z.ZodString;
    removedAt: z.ZodString;
    signerId: z.ZodString;
    signature: z.ZodString;
}, z.core.$strict>;
export type RemovalRecord = z.infer<typeof removalRecordSchema>;
export interface RemovalState {
    readonly workspaceId: string;
    /** Device id to the moment it was removed. */
    readonly removed: Readonly<Record<string, string>>;
}
export declare const removalRejectionSchema: z.ZodEnum<{
    "wrong-workspace": "wrong-workspace";
    "invalid-signature": "invalid-signature";
    "not-owner": "not-owner";
    self: "self";
}>;
export type RemovalRejection = z.infer<typeof removalRejectionSchema>;
export type RemovalResult = {
    readonly ok: true;
    readonly state: RemovalState;
} | {
    readonly ok: false;
    readonly reason: RemovalRejection;
};
export type RemovalVerifier = (payload: string, signature: string, signerId: string) => boolean;
export declare function createRemovalState(workspaceId: string): RemovalState;
export declare function removalRecordPayload(record: Pick<RemovalRecord, "workspaceId" | "deviceId" | "removedAt" | "signerId">): string;
/**
 * Take a device out, if an owner said so.
 *
 * `isOwner` is asked rather than inferred, exactly as with an invitation: roles live in the
 * role records and this module does not need to know how they got there.
 */
export declare function applyRemovalRecord(state: RemovalState, record: RemovalRecord, verify: RemovalVerifier, isOwner: (deviceId: string) => boolean): RemovalResult;
export declare function isRemoved(state: RemovalState, deviceId: string): boolean;
/**
 * Let a removed device back in.
 *
 * An owner minting a fresh invitation is the permission, so spending one is what clears the
 * mark. Without this a device that was removed could never come back, which would make
 * "remove" a one-way door nobody asked for.
 */
export declare function reinstateDevice(state: RemovalState, deviceId: string): RemovalState;
//# sourceMappingURL=removal.d.ts.map