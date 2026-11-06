import { createApplicationMessage, createCommit, createGroup, decodeGroupState, decodeMlsMessage, defaultAuthenticationService, defaultCapabilities, defaultKeyPackageEqualityConfig, defaultKeyRetentionConfig, defaultLifetime, defaultLifetimeConfig, defaultPaddingConfig, encodeGroupState, encodeMlsMessage, generateKeyPackage, getCiphersuiteFromName, getCiphersuiteImpl, joinGroup, makePskIndex, mlsExporter, nobleCryptoProvider, processPrivateMessage, } from "ts-mls";
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
export const SUITE_CIPHERSUITE = "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519";
/** What the library installs when nothing is asked for, rebuilt from its exported parts. */
const DEFAULT_CLIENT_CONFIG = {
    authService: defaultAuthenticationService,
    keyPackageEqualityConfig: defaultKeyPackageEqualityConfig,
    keyRetentionConfig: defaultKeyRetentionConfig,
    lifetimeConfig: defaultLifetimeConfig,
    paddingConfig: defaultPaddingConfig,
};
let cached = null;
function cipherSuite() {
    cached ??= getCiphersuiteImpl(getCiphersuiteFromName(SUITE_CIPHERSUITE), nobleCryptoProvider);
    return cached;
}
function groupOf(state) {
    return { state, epoch: Number(state.groupContext.epoch) };
}
export async function createDeviceIdentity(name) {
    const cs = await cipherSuite();
    const credential = { credentialType: "basic", identity: new TextEncoder().encode(name) };
    const { publicPackage, privatePackage } = await generateKeyPackage(credential, defaultCapabilities(), defaultLifetime, [], cs);
    return { name, keyPackage: publicPackage, privateKeys: privatePackage };
}
/** Start a group. The creating device is its first member and its first owner. */
export async function createWorkspaceGroup(workspaceId, identity) {
    const cs = await cipherSuite();
    const state = await createGroup(new TextEncoder().encode(workspaceId), identity.keyPackage, identity.privateKeys, [], cs);
    return groupOf(state);
}
/**
 * Add a device, and produce the two messages that make it real.
 *
 * `ratchetTreeExtension` is not optional here. A device joining from a welcome has no
 * tree of its own and a blind host has none to give it, so the welcome must carry one;
 * without it the joiner refuses the message. Measured in ADR-0006.
 */
export async function addDevice(group, keyPackage) {
    const cs = await cipherSuite();
    const result = await createCommit({ state: group.state, cipherSuite: cs }, {
        extraProposals: [{ proposalType: "add", add: { keyPackage } }],
        ratchetTreeExtension: true,
    });
    if (result.welcome === undefined) {
        throw new Error("a commit that adds a device produced no welcome");
    }
    return {
        group: groupOf(result.newState),
        commit: encodeMlsMessage(result.commit),
        welcome: encodeWelcome(result.welcome),
    };
}
/** Join from a welcome. Returns the device's group at the epoch the welcome names. */
export async function joinWorkspaceGroup(welcomeBytes, identity) {
    const cs = await cipherSuite();
    const decoded = decodeMlsMessage(welcomeBytes, 0);
    if (decoded === undefined || decoded[0].wireformat !== "mls_welcome") {
        throw new Error("that is not a welcome");
    }
    const state = await joinGroup(decoded[0].welcome, identity.keyPackage, identity.privateKeys, makePskIndex(undefined, {}), cs);
    return groupOf(state);
}
/** Encrypt one application message: a document update, or a metadata envelope. */
export async function seal(group, plaintext) {
    const cs = await cipherSuite();
    const result = await createApplicationMessage(group.state, plaintext, cs);
    return {
        group: groupOf(result.newState),
        message: encodeMlsMessage({
            version: "mls10",
            wireformat: "mls_private_message",
            privateMessage: result.privateMessage,
        }),
    };
}
/** Decrypt one application message. The host calls this on nothing, ever. */
export async function open(group, message) {
    const cs = await cipherSuite();
    const decoded = decodeMlsMessage(message, 0);
    if (decoded === undefined || decoded[0].wireformat !== "mls_private_message") {
        throw new Error("that is not an application message");
    }
    const result = await processPrivateMessage(group.state, decoded[0].privateMessage, makePskIndex(group.state, {}), cs);
    return {
        group: groupOf(result.newState),
        plaintext: result.kind === "applicationMessage" ? result.message : null,
    };
}
/**
 * A key derived from the group secret, for something the group agreed on.
 *
 * Nothing needing a stable name across epochs should use one of these: it changes when
 * the group does, which is the point.
 */
export async function exportKey(group, label, workspaceId, length = 32) {
    const cs = await cipherSuite();
    return mlsExporter(group.state.keySchedule.exporterSecret, label, new TextEncoder().encode(workspaceId), length, cs);
}
/** Persistable bytes. Losing these is losing the ability to read the workspace. */
export function encodeGroup(group) {
    return encodeGroupState(group.state);
}
/**
 * The persisted form drops the client config, which is a policy rather than a secret:
 * the encoding limits and retention rules this device applies. It is restored to the
 * library's default so a decoded group can keep working.
 */
export function decodeGroup(bytes) {
    const decoded = decodeGroupState(bytes, 0);
    if (decoded === undefined)
        throw new Error("that is not a group state");
    return groupOf({ ...decoded[0], clientConfig: DEFAULT_CLIENT_CONFIG });
}
function encodeWelcome(welcome) {
    return encodeMlsMessage({ version: "mls10", wireformat: "mls_welcome", welcome });
}
//# sourceMappingURL=group.js.map