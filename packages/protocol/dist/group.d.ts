import { type ClientState, type KeyPackage, type PrivateKeyPackage } from "ts-mls";
/**
 * The MLS group a device belongs to, and the things a device does with it.
 *
 * One group per workspace, one leaf per device. The host is not a member and never
 * calls any of this: it stores the bytes these functions produce and hands them on.
 *
 * Everything here runs in a main process, never in a renderer, so a page that
 * something else has compromised is not one bug away from a group secret.
 */
/** The mandatory-to-implement ciphersuite, fixed for the life of a group. */
export declare const SUITE_CIPHERSUITE = "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519";
/** A device's identity inside the group. The host never generates one. */
export interface DeviceIdentity {
    readonly name: string;
    readonly keyPackage: KeyPackage;
    readonly privateKeys: PrivateKeyPackage;
}
export interface DeviceGroup {
    /** Opaque MLS group state. Persist it with `encodeGroup` or lose the group. */
    readonly state: ClientState;
    /** MLS counts epochs in a bigint; the protocol counts them in a number. */
    readonly epoch: number;
}
export declare function createDeviceIdentity(name: string): Promise<DeviceIdentity>;
/** Start a group. The creating device is its first member and its first owner. */
export declare function createWorkspaceGroup(workspaceId: string, identity: DeviceIdentity): Promise<DeviceGroup>;
export interface AddDeviceResult {
    readonly group: DeviceGroup;
    /** The commit every existing member must apply. */
    readonly commit: Uint8Array;
    /** The welcome the new device joins from. */
    readonly welcome: Uint8Array;
}
/**
 * Add a device, and produce the two messages that make it real.
 *
 * `ratchetTreeExtension` is not optional here. A device joining from a welcome has no
 * tree of its own and a blind host has none to give it, so the welcome must carry one;
 * without it the joiner refuses the message. Measured in ADR-0006.
 */
export declare function addDevice(group: DeviceGroup, keyPackage: KeyPackage): Promise<AddDeviceResult>;
/** Join from a welcome. Returns the device's group at the epoch the welcome names. */
export declare function joinWorkspaceGroup(welcomeBytes: Uint8Array, identity: DeviceIdentity): Promise<DeviceGroup>;
export interface SealedMessage {
    readonly group: DeviceGroup;
    readonly message: Uint8Array;
}
/** Encrypt one application message: a document update, or a metadata envelope. */
export declare function seal(group: DeviceGroup, plaintext: Uint8Array): Promise<SealedMessage>;
export interface OpenedMessage {
    readonly group: DeviceGroup;
    /** Null when the message carried no application content this device can read. */
    readonly plaintext: Uint8Array | null;
}
/** Decrypt one application message. The host calls this on nothing, ever. */
export declare function open(group: DeviceGroup, message: Uint8Array): Promise<OpenedMessage>;
/**
 * A key derived from the group secret, for something the group agreed on.
 *
 * Nothing needing a stable name across epochs should use one of these: it changes when
 * the group does, which is the point.
 */
export declare function exportKey(group: DeviceGroup, label: string, workspaceId: string, length?: number): Promise<Uint8Array>;
/** Persistable bytes. Losing these is losing the ability to read the workspace. */
export declare function encodeGroup(group: DeviceGroup): Uint8Array;
/**
 * The persisted form drops the client config, which is a policy rather than a secret:
 * the encoding limits and retention rules this device applies. It is restored to the
 * library's default so a decoded group can keep working.
 */
export declare function decodeGroup(bytes: Uint8Array): DeviceGroup;
//# sourceMappingURL=group.d.ts.map