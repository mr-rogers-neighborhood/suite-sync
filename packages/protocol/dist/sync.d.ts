import { z } from "zod";
/** The device id the server uses for updates it originates. */
export declare const SERVER_DEVICE_ID: string;
/**
 * A version vector names each Loro peer and the highest counter this side has
 * seen. Two peers exchange vectors, then each sends the updates the other is
 * missing. `update` payloads are opaque bytes here: the protocol does not know
 * what a Loro update contains.
 */
export declare const versionVectorSchema: z.ZodRecord<z.ZodString, z.ZodNumber>;
export type VersionVector = z.infer<typeof versionVectorSchema>;
export declare const syncHelloSchema: z.ZodObject<{
    type: z.ZodLiteral<"hello">;
    protocolVersion: z.ZodNumber;
    workspaceId: z.ZodString;
    memberId: z.ZodString;
    deviceId: z.ZodString;
    epoch: z.ZodNumber;
    versionVector: z.ZodRecord<z.ZodString, z.ZodNumber>;
}, z.core.$strict>;
export declare const syncUpdateSchema: z.ZodObject<{
    type: z.ZodLiteral<"update">;
    workspaceId: z.ZodString;
    from: z.ZodString;
    to: z.ZodString;
    epoch: z.ZodNumber;
    payload: z.ZodString;
}, z.core.$strict>;
export declare const syncAckSchema: z.ZodObject<{
    type: z.ZodLiteral<"ack">;
    epoch: z.ZodNumber;
    versionVector: z.ZodRecord<z.ZodString, z.ZodNumber>;
}, z.core.$strict>;
export declare const syncErrorCodeSchema: z.ZodEnum<{
    unknown: "unknown";
    "protocol-version": "protocol-version";
    unauthorized: "unauthorized";
    forbidden: "forbidden";
    "epoch-mismatch": "epoch-mismatch";
    malformed: "malformed";
    busy: "busy";
}>;
export type SyncErrorCode = z.infer<typeof syncErrorCodeSchema>;
export declare const syncErrorSchema: z.ZodObject<{
    type: z.ZodLiteral<"error">;
    code: z.ZodEnum<{
        unknown: "unknown";
        "protocol-version": "protocol-version";
        unauthorized: "unauthorized";
        forbidden: "forbidden";
        "epoch-mismatch": "epoch-mismatch";
        malformed: "malformed";
        busy: "busy";
    }>;
    message: z.ZodString;
}, z.core.$strict>;
export declare const syncMessageSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"hello">;
    protocolVersion: z.ZodNumber;
    workspaceId: z.ZodString;
    memberId: z.ZodString;
    deviceId: z.ZodString;
    epoch: z.ZodNumber;
    versionVector: z.ZodRecord<z.ZodString, z.ZodNumber>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"update">;
    workspaceId: z.ZodString;
    from: z.ZodString;
    to: z.ZodString;
    epoch: z.ZodNumber;
    payload: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"ack">;
    epoch: z.ZodNumber;
    versionVector: z.ZodRecord<z.ZodString, z.ZodNumber>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"error">;
    code: z.ZodEnum<{
        unknown: "unknown";
        "protocol-version": "protocol-version";
        unauthorized: "unauthorized";
        forbidden: "forbidden";
        "epoch-mismatch": "epoch-mismatch";
        malformed: "malformed";
        busy: "busy";
    }>;
    message: z.ZodString;
}, z.core.$strict>], "type">;
export type SyncHello = z.infer<typeof syncHelloSchema>;
export type SyncUpdate = z.infer<typeof syncUpdateSchema>;
export type SyncAck = z.infer<typeof syncAckSchema>;
export type SyncError = z.infer<typeof syncErrorSchema>;
export type SyncMessage = z.infer<typeof syncMessageSchema>;
export type SyncParse = {
    readonly ok: true;
    readonly value: SyncMessage;
} | {
    readonly ok: false;
    readonly issues: readonly string[];
};
export declare function parseSyncMessage(value: unknown): SyncParse;
export declare function encodeSyncMessage(message: SyncMessage): string;
export declare function decodeSyncMessage(text: string): SyncParse;
export declare function emptyVersionVector(): VersionVector;
export declare function cloneVersionVector(version: VersionVector): VersionVector;
export declare function mergeVersionVector(left: VersionVector, right: VersionVector): VersionVector;
/** The entries of `target` that `current` has not seen. */
export declare function diffVersionVector(target: VersionVector, current: VersionVector): VersionVector;
export declare function isVersionVectorEmpty(version: VersionVector): boolean;
/** True when `left` has seen everything `right` has. */
export declare function coversVersionVector(left: VersionVector, right: VersionVector): boolean;
export declare function versionVectorEquals(left: VersionVector, right: VersionVector): boolean;
//# sourceMappingURL=sync.d.ts.map