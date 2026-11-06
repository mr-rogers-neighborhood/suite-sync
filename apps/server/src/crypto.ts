import { createHash, createPublicKey, verify } from "node:crypto";

/**
 * Ed25519, as the host checks it.
 *
 * A device's public key arrives as 32 raw bytes in base64. Node wants an SPKI structure,
 * and the twelve bytes that turn one into the other are fixed for Ed25519, so this wraps
 * rather than making every caller learn DER.
 */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function ed25519Verifier(
  payload: Uint8Array | string,
  signature: string,
  publicKey: string,
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey, "base64")]),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(payload), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/**
 * The device id a public key implies.
 *
 * The protocol defines an id as the SHA-256 of the device's public key, so a host can tell
 * that a device id and a key belong together instead of taking the id on trust.
 */
export function deviceIdFromPublicKey(publicKey: string): string {
  return createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex");
}
