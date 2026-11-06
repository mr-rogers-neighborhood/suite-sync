/**
 * A stable JSON encoding for signed payloads.
 *
 * `JSON.stringify` preserves insertion order, so two peers that build the same
 * object in a different order would sign different bytes. Sorting keys makes
 * the payload a property of the values, not of the code path that built them.
 */
export declare function canonicalJson(value: unknown): string;
//# sourceMappingURL=canonical.d.ts.map