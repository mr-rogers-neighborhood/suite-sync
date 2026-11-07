import { z } from "zod";
/**
 * What a host and a client say to each other.
 *
 * The host is a mailbox: it accepts frames, numbers them, and hands out the ones a
 * client has not seen. Nothing in this protocol asks it to understand a document, and
 * nothing lets it answer a question about one.
 */
/**
 * 3: a device may say something the host is asked to forget, and an owner may take a device
 * out of a workspace.
 */
export declare const RELAY_PROTOCOL_VERSION = 3;
export declare const relayClientMessageSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"join">;
    protocolVersion: z.ZodNumber;
    workspaceId: z.ZodString;
    deviceId: z.ZodString;
    publicKey: z.ZodString;
    name: z.ZodString;
    inviteId: z.ZodOptional<z.ZodString>;
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
    type: z.ZodLiteral<"ephemeral">;
    workspaceId: z.ZodString;
    deviceId: z.ZodString;
    payload: z.ZodString;
    signature: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"removal">;
    record: z.ZodObject<{
        workspaceId: z.ZodString;
        deviceId: z.ZodString;
        removedAt: z.ZodString;
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
/**
 * One device the host will accept a frame from, as the host already knows it: the name it
 * gave on the way in and the role it was granted.
 *
 * The host is not reading anything to produce this. It admits frames by role and pins a key
 * per device, so it holds exactly these three fields and is telling members what it must
 * already know to do its job.
 */
declare const memberSchema: z.ZodObject<{
    deviceId: z.ZodString;
    name: z.ZodString;
    role: z.ZodEnum<{
        owner: "owner";
        editor: "editor";
        viewer: "viewer";
    }>;
}, z.core.$strict>;
declare const joinedSchema: z.ZodObject<{
    type: z.ZodLiteral<"joined">;
    protocolVersion: z.ZodNumber;
    workspaceId: z.ZodString;
    newestEpoch: z.ZodNullable<z.ZodNumber>;
    frames: z.ZodNumber;
    members: z.ZodArray<z.ZodObject<{
        deviceId: z.ZodString;
        name: z.ZodString;
        role: z.ZodEnum<{
            owner: "owner";
            editor: "editor";
            viewer: "viewer";
        }>;
    }, z.core.$strict>>;
}, z.core.$strict>;
/** A forwarded presence message. Not numbered, because nothing keeps it. */
declare const ephemeralOutSchema: z.ZodObject<{
    type: z.ZodLiteral<"ephemeral">;
    workspaceId: z.ZodString;
    deviceId: z.ZodString;
    payload: z.ZodString;
    signature: z.ZodString;
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
/**
 * A device is waiting to be let in, and this is the invitation it spent.
 *
 * An owner has to write the joiner's role record, and the role was decided by whoever wrote
 * the invitation — which need not be the device doing the admitting, so it cannot be looked
 * up locally. The host read the invitation to decide whether to honour it, so it is the one
 * party that can answer. The invitation is already spent by the time this is sent.
 */
declare const waitingSchema: z.ZodObject<{
    type: z.ZodLiteral<"waiting">;
    deviceId: z.ZodString;
    name: z.ZodString;
    inviteId: z.ZodString;
    role: z.ZodEnum<{
        owner: "owner";
        editor: "editor";
        viewer: "viewer";
    }>;
}, z.core.$strict>;
export declare const relayErrorCodeSchema: z.ZodEnum<{
    unknown: "unknown";
    "protocol-version": "protocol-version";
    "not-joined": "not-joined";
    malformed: "malformed";
}>;
export type RelayErrorCode = z.infer<typeof relayErrorCodeSchema>;
/**
 * Who is in the workspace now.
 *
 * Sent to every socket in the room whenever a role record is applied, so a device's view of
 * its neighbours does not depend on when it happened to join. `joined` carries the same list
 * for the moment of joining; this is what keeps it true afterwards.
 */
declare const rosterSchema: z.ZodObject<{
    type: z.ZodLiteral<"roster">;
    members: z.ZodArray<z.ZodObject<{
        deviceId: z.ZodString;
        name: z.ZodString;
        role: z.ZodEnum<{
            owner: "owner";
            editor: "editor";
            viewer: "viewer";
        }>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const relayHostMessageSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"joined">;
    protocolVersion: z.ZodNumber;
    workspaceId: z.ZodString;
    newestEpoch: z.ZodNullable<z.ZodNumber>;
    frames: z.ZodNumber;
    members: z.ZodArray<z.ZodObject<{
        deviceId: z.ZodString;
        name: z.ZodString;
        role: z.ZodEnum<{
            owner: "owner";
            editor: "editor";
            viewer: "viewer";
        }>;
    }, z.core.$strict>>;
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
    type: z.ZodLiteral<"waiting">;
    deviceId: z.ZodString;
    name: z.ZodString;
    inviteId: z.ZodString;
    role: z.ZodEnum<{
        owner: "owner";
        editor: "editor";
        viewer: "viewer";
    }>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"roster">;
    members: z.ZodArray<z.ZodObject<{
        deviceId: z.ZodString;
        name: z.ZodString;
        role: z.ZodEnum<{
            owner: "owner";
            editor: "editor";
            viewer: "viewer";
        }>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"ephemeral">;
    workspaceId: z.ZodString;
    deviceId: z.ZodString;
    payload: z.ZodString;
    signature: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"removed">;
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
        removed: "removed";
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
    }>, z.ZodEnum<{
        "wrong-workspace": "wrong-workspace";
        "invalid-signature": "invalid-signature";
        "not-owner": "not-owner";
        self: "self";
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
export type RelayWaiting = z.infer<typeof waitingSchema>;
export type RelayEphemeral = z.infer<typeof ephemeralOutSchema>;
/** The part of a presence message that is signed, and the part that is not. */
export type EphemeralBody = Omit<RelayEphemeral, "type" | "signature">;
/** One presence message, as its sender writes it and its readers see it. */
export type EphemeralMessage = EphemeralBody & {
    readonly signature: string;
};
/**
 * The bytes a device signs for a presence message.
 *
 * The host checks this before forwarding, because otherwise any socket could speak as any
 * device and a workspace's "who is here" would be whatever a passer-by said it was.
 */
export declare function ephemeralPayload(message: EphemeralBody): Uint8Array;
export type RelayRoster = z.infer<typeof rosterSchema>;
export type RelayMember = z.infer<typeof memberSchema>;
export type RelayFrame = z.infer<typeof frameOutSchema>;
export declare function encodeRelayMessage(message: RelayClientMessage | RelayHostMessage): string;
export declare function parseClientMessage(value: unknown): RelayClientMessage | null;
export declare function parseHostMessage(value: unknown): RelayHostMessage | null;
/** Whether a client may speak to this host at all. */
export declare function isRelayCompatible(version: number): boolean;
export {};
//# sourceMappingURL=relay.d.ts.map