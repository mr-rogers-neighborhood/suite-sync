/**
 * The wire protocol version.
 *
 * This is separate from the app/hub contract version in `@suite/contracts`.
 * A server can speak a new sync protocol without changing what a `suite.app`
 * manifest means, and vice versa.
 */
export declare const SYNC_PROTOCOL_VERSION = 1;
export declare function isProtocolCompatible(version: number): boolean;
//# sourceMappingURL=version.d.ts.map