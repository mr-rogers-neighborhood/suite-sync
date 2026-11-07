import { createApplicationMessage, createCommit, createGroup, decodeGroupState, decodeMlsMessage, defaultAuthenticationService, defaultCapabilities, defaultKeyPackageEqualityConfig, defaultKeyRetentionConfig, defaultLifetime, defaultLifetimeConfig, defaultPaddingConfig, encodeGroupState, encodeMlsMessage, generateKeyPackage, getCiphersuiteFromName, getCiphersuiteImpl, joinGroup, makePskIndex, mlsExporter, nobleCryptoProvider, processPrivateMessage, processPublicMessage, } from "ts-mls";
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
/**
 * The leaf index of a device, by the name it joined under.
 *
 * This is the leaf's *ordinal*, not its position in the tree array: leaves live at even
 * node indices, and `remove` is addressed by the ordinal. Getting that wrong asks the
 * library to remove a node that does not exist, which it refuses.
 *
 * A device that is not in the tree has no index, which is what makes this safe to call
 * before a removal and useless afterwards.
 */
export function leafIndexOf(group, name) {
    const wanted = new TextEncoder().encode(name);
    const tree = group.state.ratchetTree;
    for (let index = 0; index < tree.length; index += 2) {
        const node = tree[index];
        if (node === undefined || node.nodeType !== "leaf")
            continue;
        const identity = node.leaf.credential.credentialType === "basic" ? node.leaf.credential.identity : null;
        if (identity === null || identity.length !== wanted.length)
            continue;
        if (identity.every((byte, offset) => byte === wanted[offset]))
            return index / 2;
    }
    return null;
}
/**
 * Remove a device. This is the revocation, and it is the only one.
 *
 * The commit advances the epoch, which is what denies the removed device everything that
 * follows: it does not hold the new epoch's secrets, so a message sealed after this
 * commit is not something it can read, whatever the host does.
 */
export async function removeDevice(group, leafIndex) {
    const cs = await cipherSuite();
    const result = await createCommit({ state: group.state, cipherSuite: cs }, { extraProposals: [{ proposalType: "remove", remove: { removed: leafIndex } }] });
    return { group: groupOf(result.newState), commit: encodeMlsMessage(result.commit) };
}
/**
 * Apply a commit somebody else wrote.
 *
 * This is what keeps a member in step when the membership changes: an Add or a Remove moves
 * the group to a new epoch, and every other device has to move with it or it spends the rest
 * of the workspace unable to read anything. A device applies its *own* commits by creating
 * them, so this is only ever for somebody else's.
 */
export async function applyCommit(group, commit) {
    const cs = await cipherSuite();
    const decoded = decodeMlsMessage(commit, 0);
    if (decoded === undefined)
        throw new Error("that is not a commit");
    const message = decoded[0];
    // A commit is a public message or a private one, depending on how it was created; the
    // library decides, and both arrive here looking like a commit to everyone else.
    if (message.wireformat === "mls_public_message") {
        const result = await processPublicMessage(group.state, message.publicMessage, makePskIndex(group.state, {}), cs);
        return { group: groupOf(result.newState) };
    }
    if (message.wireformat === "mls_private_message") {
        const result = await processPrivateMessage(group.state, message.privateMessage, makePskIndex(group.state, {}), cs);
        return { group: groupOf(result.newState) };
    }
    throw new Error("that is not a commit");
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
/**
 * A key package on the wire, and back.
 *
 * This is the one thing a device with no role may send. It is public by design: the host
 * carries it to an owner, who is the only party that can turn it into membership.
 */
export function encodeKeyPackageBytes(keyPackage) {
    return encodeMlsMessage({ version: "mls10", wireformat: "mls_key_package", keyPackage });
}
export function decodeKeyPackageBytes(bytes) {
    const decoded = decodeMlsMessage(bytes, 0);
    if (decoded === undefined || decoded[0].wireformat !== "mls_key_package") {
        throw new Error("that is not a key package");
    }
    return decoded[0].keyPackage;
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