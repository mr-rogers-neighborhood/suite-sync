import { z } from "zod";
/**
 * What a host and a client say to each other.
 *
 * The host is a mailbox: it accepts frames, numbers them, and hands out the ones a
 * client has not seen. Nothing in this protocol asks it to understand a document, and
 * nothing lets it answer a question about one.
 */
export declare const RELAY_PROTOCOL_VERSION = 1;
export declare const relayClientMessageSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"join">;
    protocolVersion: z.ZodNumber;
    workspaceId: z.ZodString;
    deviceId: z.ZodString;
    publicKey: z.ZodString;
    name: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"invite">;
    record: z.ZodObject<{
        workspaceId: z.ZodString;
        inviteId: z.ZodString;
        role: z.ZodEnum<{
            owner: "owner";
            editor: "editor";
            viewer: "viewer";
        }>;
        expiresAt: z.ZodString;
        signerId: z.ZodString;
        signature: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"keypackage">;
    inviteId: z.ZodString;
    deviceId: z.ZodString;
    publicKey: z.ZodString;
    name: z.ZodString;
    frame: z.ZodObject<{
        kind: z.ZodEnum<{
            keypackage: "keypackage";
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
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"role">;
    record: z.ZodObject<{
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
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"frame">;
    frame: z.ZodObject<{
        kind: z.ZodEnum<{
            keypackage: "keypackage";
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
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"since">;
    after: z.ZodNumber;
}, z.core.$strict>], "type">;
export type RelayClientMessage = z.infer<typeof relayClientMessageSchema>;
declare const joinedSchema: z.ZodObject<{
    type: z.ZodLiteral<"joined">;
    protocolVersion: z.ZodNumber;
    workspaceId: z.ZodString;
    newestEpoch: z.ZodNullable<z.ZodNumber>;
    frames: z.ZodNumber;
}, z.core.$strict>;
/** A frame with its position, so a client can ask for what comes after it. */
declare const frameOutSchema: z.ZodObject<{
    type: z.ZodLiteral<"frame">;
    index: z.ZodNumber;
    frame: z.ZodObject<{
        kind: z.ZodEnum<{
            keypackage: "keypackage";
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
}, z.core.$strict>;
/**
 * A role record the host applied, echoed to the device that sent it.
 *
 * Without this a client cannot tell whether its role landed, and an app has to know it is
 * an owner before it offers to invite anything.
 */
declare const appliedSchema: z.ZodObject<{
    type: z.ZodLiteral<"applied">;
    deviceId: z.ZodString;
    role: z.ZodEnum<{
        owner: "owner";
        editor: "editor";
        viewer: "viewer";
    }>;
    seq: z.ZodNumber;
}, z.core.$strict>;
export declare const relayErrorCodeSchema: z.ZodEnum<{
    unknown: "unknown";
    "protocol-version": "protocol-version";
    "not-joined": "not-joined";
    malformed: "malformed";
}>;
export type RelayErrorCode = z.infer<typeof relayErrorCodeSchema>;
export declare const relayHostMessageSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"joined">;
    protocolVersion: z.ZodNumber;
    workspaceId: z.ZodString;
    newestEpoch: z.ZodNullable<z.ZodNumber>;
    frames: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"applied">;
    deviceId: z.ZodString;
    role: z.ZodEnum<{
        owner: "owner";
        editor: "editor";
        viewer: "viewer";
    }>;
    seq: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"invited">;
    inviteId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"frame">;
    index: z.ZodNumber;
    frame: z.ZodObject<{
        kind: z.ZodEnum<{
            keypackage: "keypackage";
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
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"refused">;
    reason: z.ZodUnion<readonly [z.ZodEnum<{
        "wrong-workspace": "wrong-workspace";
        "stale-epoch": "stale-epoch";
        "not-authorized": "not-authorized";
        "invalid-signature": "invalid-signature";
    }>, z.ZodEnum<{
        "wrong-workspace": "wrong-workspace";
        "invalid-signature": "invalid-signature";
        "not-owner": "not-owner";
        "wrong-seq": "wrong-seq";
        "last-owner": "last-owner";
        "role-unchanged": "role-unchanged";
    }>, z.ZodEnum<{
        "wrong-workspace": "wrong-workspace";
        "invalid-signature": "invalid-signature";
        "not-owner": "not-owner";
        expired: "expired";
        "unknown-invite": "unknown-invite";
        "invite-spent": "invite-spent";
    }>]>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"error">;
    code: z.ZodEnum<{
        unknown: "unknown";
        "protocol-version": "protocol-version";
        "not-joined": "not-joined";
        malformed: "malformed";
    }>;
    message: z.ZodString;
}, z.core.$strict>], "type">;
export type RelayHostMessage = z.infer<typeof relayHostMessageSchema>;
export type RelayJoined = z.infer<typeof joinedSchema>;
export type RelayApplied = z.infer<typeof appliedSchema>;
export type RelayFrame = z.infer<typeof frameOutSchema>;
export declare function encodeRelayMessage(message: RelayClientMessage | RelayHostMessage): string;
export declare function parseClientMessage(value: unknown): RelayClientMessage | null;
export declare function parseHostMessage(value: unknown): RelayHostMessage | null;
/** Whether a client may speak to this host at all. */
export declare function isRelayCompatible(version: number): boolean;
export {};
//# sourceMappingURL=relay.d.ts.map