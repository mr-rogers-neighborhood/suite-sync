import { z } from "zod";
/**
 * An id is a 32-byte fingerprint encoded as 64 lower-case hex characters.
 *
 * The protocol treats ids as opaque. Deriving one from an Ed25519 public key is
 * the crypto layer's job; keeping that out of the protocol is what lets the
 * membership state machine be tested without a key store.
 */
const ID_PATTERN = /^[a-f0-9]{64}$/u;
const idSchema = z.string().regex(ID_PATTERN, "an id is 64 lower-case hex characters");
export const workspaceIdSchema = idSchema;
export const deviceIdSchema = idSchema;
export const memberIdSchema = idSchema;
export const inviteIdSchema = idSchema;
export function isWorkspaceId(value) {
    return workspaceIdSchema.safeParse(value).success;
}
export function isDeviceId(value) {
    return deviceIdSchema.safeParse(value).success;
}
export function isMemberId(value) {
    return memberIdSchema.safeParse(value).success;
}
export function isInviteId(value) {
    return inviteIdSchema.safeParse(value).success;
}
//# sourceMappingURL=ids.js.map