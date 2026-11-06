export declare function ed25519Verifier(payload: Uint8Array | string, signature: string, publicKey: string): boolean;
/**
 * The device id a public key implies.
 *
 * The protocol defines an id as the SHA-256 of the device's public key, so a host can tell
 * that a device id and a key belong together instead of taking the id on trust.
 */
export declare function deviceIdFromPublicKey(publicKey: string): string;
//# sourceMappingURL=crypto.d.ts.map