/**
 * Formatting shared across the Observability pages (traces, services, logs).
 *
 * This module exists because traces and services independently grew their own
 * `formatDuration` and then DISAGREED: 90s rendered as "1m 30s" in the trace
 * waterfall and "90s" in the services table, and 0.4ms as "<1ms" in one and
 * "400µs" in the other — the same span could show two different durations
 * depending on which page you were looking at.
 *
 * Only genuinely cross-page helpers belong here. Count/percent/timestamp
 * formatting is still services-local because nothing else renders those yet.
 */

/**
 * A latency/duration in milliseconds, rendered at the precision a reader
 * actually needs at that magnitude. `null` (and non-finite/negative input,
 * which is what an unfinished span produces) renders as an em dash rather than
 * a misleading "0s".
 */
export function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms === 0) return "0s";
  // Sub-millisecond work is real (in-process cache hits, cheap library spans);
  // the old traces-side "<1ms" collapsed a whole class of span into one label.
  if (ms < 1) return `${Math.round(ms * 1000)}µs`;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  // One decimal only below 10s: past that the tenths are noise next to the
  // second-level differences a reader is comparing.
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  if (ms < 3_600_000) {
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }
  if (ms < 86_400_000) {
    const totalMinutes = Math.round(ms / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }
  const totalHours = Math.round(ms / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

/**
 * ClickHouse hands JSON columns back as strings. Parses when it can and returns
 * the original value otherwise — a malformed blob should still be displayable in
 * a detail dialog rather than blanking the row.
 */
export function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
