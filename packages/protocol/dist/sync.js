import { z } from "zod";
import { deviceIdSchema, memberIdSchema, workspaceIdSchema } from "./ids.js";
/**
 * A version vector names each Loro peer and the highest counter this side has
 * seen. Two peers exchange vectors, then each sends the updates the other is
 * missing. `update` payloads are opaque bytes here: the protocol does not know
 * what a Loro update contains.
 */
export const versionVectorSchema = z.record(z.string().min(1), z.number().int().nonnegative());
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
export function parseSyncMessage(value) {
    const parsed = syncMessageSchema.safeParse(value);
    if (parsed.success)
        return { ok: true, value: parsed.data };
    return {
        ok: false,
        issues: parsed.error.issues.map((issue) => {
            const path = issue.path.map(String).join(".");
            return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
        }),
    };
}
export function encodeSyncMessage(message) {
    return JSON.stringify(message);
}
export function decodeSyncMessage(text) {
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        return { ok: false, issues: ["the message is not JSON"] };
    }
    return parseSyncMessage(value);
}
export function emptyVersionVector() {
    return {};
}
export function cloneVersionVector(version) {
    return { ...version };
}
export function mergeVersionVector(left, right) {
    const merged = { ...left };
    for (const [peer, counter] of Object.entries(right)) {
        merged[peer] = Math.max(merged[peer] ?? 0, counter);
    }
    return merged;
}
/** The entries of `target` that `current` has not seen. */
export function diffVersionVector(target, current) {
    const missing = {};
    for (const [peer, counter] of Object.entries(target)) {
        if (counter > (current[peer] ?? 0))
            missing[peer] = counter;
    }
    return missing;
}
export function isVersionVectorEmpty(version) {
    return Object.keys(version).length === 0;
}
/** True when `left` has seen everything `right` has. */
export function coversVersionVector(left, right) {
    for (const [peer, counter] of Object.entries(right)) {
        if ((left[peer] ?? 0) < counter)
            return false;
    }
    return true;
}
export function versionVectorEquals(left, right) {
    return coversVersionVector(left, right) && coversVersionVector(right, left);
}
//# sourceMappingURL=sync.js.map