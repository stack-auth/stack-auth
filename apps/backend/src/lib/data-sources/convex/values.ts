import { CONVEX_CREATION_TIME_COLUMN } from "./probe";

/**
 * Converts a Convex document into the values its destination columns accept.
 *
 * Two of Convex's own encodings do not survive the generic row builder:
 *
 *  - `_creationTime` is milliseconds since the epoch *as a float*
 *    (1788368196628.201). Written straight into a DateTime64(3) column,
 *    ClickHouse reads the integer part and then rejects the batch on the
 *    fractional one. An ISO string is unambiguous, and millisecond precision is
 *    what Convex documents the field as carrying anyway.
 *
 *  - Bytes arrive as `{"$bytes": "<base64>"}`. The generic builder would
 *    JSON-stringify that wrapper into the String column, leaving the customer to
 *    unwrap it themselves; the base64 payload is what they actually want.
 *
 * Everything else — scalars, and the nested objects and arrays that become JSON
 * text — is left for the shared row builder to handle.
 */
export function toDestinationValues(document: Record<string, unknown>): Record<string, unknown> {
  // Built through fromEntries rather than by assignment: assigning a field named
  // `__proto__` to a plain object mutates its prototype instead of creating an
  // own property, and `buildDestinationRow` skips anything that is not an own
  // property — so the column would silently arrive empty.
  return Object.fromEntries(Object.entries(document).map(([name, value]) => [
    name,
    name === CONVEX_CREATION_TIME_COLUMN ? toIsoMillis(value) : unwrapBytes(value),
  ]));
}

function toIsoMillis(value: unknown): unknown {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  return new Date(value).toISOString();
}

function unwrapBytes(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const keys = Object.keys(value);
  // Only the wrapper itself, never an object that merely contains such a key.
  // Convex forbids `$`-prefixed field names so a real document cannot hit this,
  // but collapsing a whole object down to one of its fields is a bad enough
  // failure to be worth ruling out rather than reasoning about.
  if (keys.length !== 1 || keys[0] !== "$bytes") return value;
  const wrapped = (value as { $bytes: unknown }).$bytes;
  return typeof wrapped === "string" ? wrapped : value;
}
