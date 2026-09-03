export const MAX_JAVASCRIPT_TIMESTAMP_MILLIS = 8_640_000_000_000_000;

/**
 * Client clocks are useful for assigning usage to the right period, but they
 * are not trusted to move a debit into a future period or construct an invalid
 * Date. Malformed protocol timestamps fall back to the earliest accepted item.
 */
export function telemetryMeteredAt(
  clientTimestamp: number | string | null,
  fallbackTimestampMs: number,
  receivedAt: Date,
): Date {
  const parsed = typeof clientTimestamp === "string" ? Date.parse(clientTimestamp) : clientTimestamp;
  const timestampMs = parsed !== null
    && Number.isFinite(parsed)
    && parsed >= 0
    && parsed <= MAX_JAVASCRIPT_TIMESTAMP_MILLIS
    ? parsed
    : fallbackTimestampMs;
  return new Date(Math.min(timestampMs, receivedAt.getTime()));
}
