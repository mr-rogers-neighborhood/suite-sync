import { z } from "zod";
import { deviceIdSchema, workspaceIdSchema } from "./ids.js";
/**
 * One stored record, as the host sees it.
 *
 * The host reads the header, refuses what it must refuse, and stores the payload
 * without ever decoding it. Everything a person would recognise — a title, a file
 * name, a word of the document — is inside `payload`, which is MLS ciphertext.
 *
 * A frame is signed by the device that sent it, so a reader can attribute a change
 * without trusting the host's ordering.
 */
export const frameKindSchema = z.enum(["keypackage", "commit", "welcome", "application"]);
export const frameHeaderSchema = z
    .object({
    kind: frameKindSchema,
    workspaceId: workspaceIdSchema,
    deviceId: deviceIdSchema,
    /** The MLS epoch the sender was in when it wrote this. */
    epoch: z.number().int().nonnegative(),
    /** Base64 of the encoded MLS message. */
    payload: z.string().min(1),
})
    .strict();
/**
 * A frame as a sender writes it: the header plus its signature, and no arrival time.
 *
 * The sender must not claim when its frame arrived. That field is the host's, and a
 * client-side clock is exactly the sort of thing that decides which of two frames looks
 * newer.
 */
export const sealedFrameSchema = frameHeaderSchema
    .extend({
    /** Device-key signature over the header fields and the payload. */
    signature: z.string().min(1),
})
    .strict();
export const frameSchema = sealedFrameSchema
    .extend({
    /** Stamped by the host on arrival, not claimed by the sender. */
    receivedAt: z.string().min(1),
})
    .strict();
/** The bytes a device signs, and the bytes a reader verifies. */
export function framePayload(header) {
    const ordered = [
        header.kind,
        header.workspaceId,
        header.deviceId,
        String(header.epoch),
        header.payload,
    ].join("\n");
    return new TextEncoder().encode(ordered);
}
/**
 * Why a frame was refused.
 *
 * The first two are the receiving client's reasons; the last two are the host's. They
 * travel on the wire, so they are one vocabulary rather than two.
 */
export const frameRejectionSchema = z.enum([
    "wrong-workspace",
    "stale-epoch",
    "not-authorized",
    "invalid-signature",
]);
/**
 * Whether a client may read this frame.
 *
 * MLS does not answer this. A commit whose epoch has already passed is decrypted
 * with the retained receiver data and handed back as an application message rather
 * than refused (ADR-0006, measured), so two devices that committed from the same
 * epoch would each quietly absorb the other's and disagree about the group. The
 * receiver compares epochs and drops what is not for the epoch it is in.
 */
export function frameRejection(frame, current) {
    if (frame.workspaceId !== current.workspaceId)
        return "wrong-workspace";
    if (frame.epoch !== current.epoch)
        return "stale-epoch";
    return null;
}
/**
 * Whether the host should store a frame at all.
 *
 * A host refuses an epoch older than the newest it has stored for the workspace: a
 * frame that arrives after the group has moved on is not a late delivery, it is a
 * sender that was not in the group when it wrote. Equal and newer are both accepted,
 * because the sender's commit is how the epoch moves.
 */
export function hostAcceptsEpoch(frameEpoch, newestStored) {
    if (newestStored === null)
        return true;
    return frameEpoch >= newestStored;
}
//# sourceMappingURL=frame.js.map