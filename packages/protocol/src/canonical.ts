/**
 * A stable JSON encoding for signed payloads.
 *
 * `JSON.stringify` preserves insertion order, so two peers that build the same
 * object in a different order would sign different bytes. Sorting keys makes
 * the payload a property of the values, not of the code path that built them.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry !== undefined) sorted[key] = sortValue(entry);
    }
    return sorted;
  }
  return value;
}
