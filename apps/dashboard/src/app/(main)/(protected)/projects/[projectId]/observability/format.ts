/**
 * Formatting shared across the Observability pages (traces, services, logs).
 *
 * This module exists because traces and services independently grew their own
 * `formatDuration` and then DISAGREED: 90s rendered as "1m 30s" in the trace
 * waterfall and "90s" in the services table, and 0.4ms as "<1ms" in one and
 * "400µs" in the other — the same span could show two different durations
 * depending on which page you were looking at.
 *
 * Only genuinely cross-page helpers belong here. Count formatting lives here
 * too, because Services, Performance, and Issues all render compact counts and
 * had each grown an identical copy. Percent formatting stays page-local: the
 * pages render percents at deliberately different precision (Services shows one
 * decimal in dense cells, Performance rounds to whole percents in summaries),
 * so there is no single shared rule to lift.
 *
 * The time formatters take epoch milliseconds rather than a ClickHouse
 * timestamp string: Issues gets its timestamps from a REST payload (`*_millis`
 * numbers) while Services reads them out of ClickHouse rows, and milliseconds
 * is the only representation both already have. `services-format.ts` keeps the
 * string-shaped wrappers its call sites use.
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
 * Compact count formatting for dense table cells. Values below 10k stay exact
 * because at that size the digits are still readable and the precision matters
 * when comparing two similar rows; above that only the magnitude counts, so
 * 10k–100k keeps one decimal ("12.5k"), then "125k", "1.5M", "15M".
 *
 * Counts are non-negative by definition, so a negative value means an upstream
 * aggregation bug — fail loudly rather than rendering "-50,000" (the thresholds
 * only make sense for positive magnitudes anyway).
 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Cannot format a non-finite count: ${value}`);
  if (value < 0) throw new Error(`Cannot format a negative count: ${value}`);
  if (value < 10_000) return value.toLocaleString();
  if (value < 1_000_000) {
    const thousands = (value / 1_000).toFixed(value < 100_000 ? 1 : 0);
    return thousands === "1000" ? "1.0M" : `${thousands}k`;
  }
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`;
}

const RELATIVE_TIME_UNITS: readonly { limitMs: number, divisorMs: number, unit: Intl.RelativeTimeFormatUnit }[] = [
  { limitMs: 60_000, divisorMs: 1_000, unit: "second" },
  { limitMs: 3_600_000, divisorMs: 60_000, unit: "minute" },
  { limitMs: 86_400_000, divisorMs: 3_600_000, unit: "hour" },
  { limitMs: 2_592_000_000, divisorMs: 86_400_000, unit: "day" },
];

/**
 * "2m ago" / "3h ago". Recency is the primary thing a reader scans an
 * Observability table for, and an absolute timestamp forces them to do the
 * subtraction themselves.
 *
 * `nowMs` is passed in rather than read from the clock so a table full of these
 * renders one consistent "now" — and so tests are deterministic.
 */
export function formatRelativeTimeFromMillis(millis: number, nowMs: number): string {
  if (!Number.isFinite(millis)) throw new Error(`Cannot format a non-finite timestamp: ${millis}`);
  const elapsedMs = nowMs - millis;
  // Clock skew between the browser and the server can make a fresh row look
  // like it arrived in the future; "just now" is truthful for both cases.
  if (elapsedMs < 45_000) return "just now";

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" });
  for (const { limitMs, divisorMs, unit } of RELATIVE_TIME_UNITS) {
    if (elapsedMs < limitMs) {
      return formatter.format(-Math.round(elapsedMs / divisorMs), unit);
    }
  }
  return formatter.format(-Math.round(elapsedMs / 2_592_000_000), "month");
}

/** "12 Mar, 14:05" — the tooltip/secondary companion to the relative form. */
export function formatAbsoluteTimeFromMillis(millis: number): string {
  if (!Number.isFinite(millis)) throw new Error(`Cannot format a non-finite timestamp: ${millis}`);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(millis));
}

/**
 * Date only, no clock. Used where the time of day would be noise — e.g. the
 * "counters are only complete since <date>" note an unmerged issue carries.
 */
export function formatDateFromMillis(millis: number): string {
  if (!Number.isFinite(millis)) throw new Error(`Cannot format a non-finite timestamp: ${millis}`);
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(millis));
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
