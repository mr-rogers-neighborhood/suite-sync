/**
 * Base64 for sync payloads.
 *
 * Implemented here rather than reached from `Buffer` or `btoa` so the protocol
 * stays usable in a renderer, a Node server and a test with no platform shim.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = Object.fromEntries(Array.from(ALPHABET, (char, index) => [char, index]));
export function encodeBase64(bytes) {
    let encoded = "";
    for (let index = 0; index < bytes.length; index += 3) {
        const first = bytes[index] ?? 0;
        const second = bytes[index + 1];
        const third = bytes[index + 2];
        encoded += ALPHABET.charAt(first >> 2);
        encoded += ALPHABET.charAt(((first & 0x03) << 4) | ((second ?? 0) >> 4));
        encoded +=
            second === undefined ? "=" : ALPHABET.charAt(((second & 0x0f) << 2) | ((third ?? 0) >> 6));
        encoded += third === undefined ? "=" : ALPHABET.charAt(third & 0x3f);
    }
    return encoded;
}
/** Decode base64, or null when a character is outside the alphabet. */
export function decodeBase64(value) {
    const trimmed = value.replace(/=+$/u, "");
    const bytes = [];
    let buffer = 0;
    let bits = 0;
    for (const char of trimmed) {
        const index = LOOKUP[char];
        if (index === undefined)
            return null;
        buffer = (buffer << 6) | index;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((buffer >> bits) & 0xff);
        }
    }
    return Uint8Array.from(bytes);
}
//# sourceMappingURL=base64.js.map