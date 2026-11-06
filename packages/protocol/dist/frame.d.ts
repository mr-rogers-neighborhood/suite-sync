import { z } from "zod";
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
export declare const frameKindSchema: z.ZodEnum<{
    commit: "commit";
    welcome: "welcome";
    application: "application";
}>;
export type FrameKind = z.infer<typeof frameKindSchema>;
export declare const frameHeaderSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        commit: "commit";
        welcome: "welcome";
        application: "application";
    }>;
    workspaceId: z.ZodString;
    deviceId: z.ZodString;
    epoch: z.ZodNumber;
    payload: z.ZodString;
}, z.core.$strict>;
export type FrameHeader = z.infer<typeof frameHeaderSchema>;
/**
 * A frame as a sender writes it: the header plus its signature, and no arrival time.
 *
 * The sender must not claim when its frame arrived. That field is the host's, and a
 * client-side clock is exactly the sort of thing that decides which of two frames looks
 * newer.
 */
export declare const sealedFrameSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        commit: "commit";
        welcome: "welcome";
        application: "application";
    }>;
    workspaceId: z.ZodString;
    deviceId: z.ZodString;
    epoch: z.ZodNumber;
    payload: z.ZodString;
    signature: z.ZodString;
}, z.core.$strict>;
export type SealedFrame = z.infer<typeof sealedFrameSchema>;
export declare const frameSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        commit: "commit";
        welcome: "welcome";
        application: "application";
    }>;
    workspaceId: z.ZodString;
    deviceId: z.ZodString;
    epoch: z.ZodNumber;
    payload: z.ZodString;
    signature: z.ZodString;
    receivedAt: z.ZodString;
}, z.core.$strict>;
export type Frame = z.infer<typeof frameSchema>;
/** The bytes a device signs, and the bytes a reader verifies. */
export declare function framePayload(header: FrameHeader): Uint8Array;
/**
 * Why a frame was refused.
 *
 * The first two are the receiving client's reasons; the last two are the host's. They
 * travel on the wire, so they are one vocabulary rather than two.
 */
export declare const frameRejectionSchema: z.ZodEnum<{
    "wrong-workspace": "wrong-workspace";
    "stale-epoch": "stale-epoch";
    "not-authorized": "not-authorized";
    "invalid-signature": "invalid-signature";
}>;
export type FrameRejection = z.infer<typeof frameRejectionSchema>;
/**
 * Whether a client may read this frame.
 *
 * MLS does not answer this. A commit whose epoch has already passed is decrypted
 * with the retained receiver data and handed back as an application message rather
 * than refused (ADR-0006, measured), so two devices that committed from the same
 * epoch would each quietly absorb the other's and disagree about the group. The
 * receiver compares epochs and drops what is not for the epoch it is in.
 */
export declare function frameRejection(frame: Pick<Frame, "workspaceId" | "epoch">, current: {
    workspaceId: string;
    epoch: number;
}): FrameRejection | null;
/**
 * Whether the host should store a frame at all.
 *
 * A host refuses an epoch older than the newest it has stored for the workspace: a
 * frame that arrives after the group has moved on is not a late delivery, it is a
 * sender that was not in the group when it wrote. Equal and newer are both accepted,
 * because the sender's commit is how the epoch moves.
 */
export declare function hostAcceptsEpoch(frameEpoch: number, newestStored: number | null): boolean;
//# sourceMappingURL=frame.d.ts.map