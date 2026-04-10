/**
 * SpacetimeDB timestamps are { __timestamp_micros_since_unix_epoch__: bigint }.
 * Convert to a JS Date.
 */
export function toDate(ts: unknown): Date {
  if (ts instanceof Date) return ts;
  if (typeof ts === "object" && ts !== null && "__timestamp_micros_since_unix_epoch__" in ts) {
    const micros = (ts as { __timestamp_micros_since_unix_epoch__: bigint }).__timestamp_micros_since_unix_epoch__;
    return new Date(Number(micros / 1000n));
  }
  if (typeof ts === "bigint") {
    return new Date(Number(ts / 1000n));
  }
  if (typeof ts === "number") {
    return new Date(ts);
  }
  return new Date(0);
}
