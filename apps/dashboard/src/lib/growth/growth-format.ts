import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { GROWTH_METRIC_IDS, type GrowthCatalogMetricUnit, type GrowthMetricId } from "./growth-types";

// Pure, locale-independent formatting helpers shared by the growth pages. Everything here is
// deterministic given its inputs (no Date.now(), no locale lookups) so demo mode renders identically
// on every load and the colocated test can snapshot exact strings.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const GROWTH_METRIC_LABELS = new Map<GrowthMetricId, string>([
  ["new_signups", "New signups"],
  ["returning_users", "Returning users"],
  ["transactions", "Transactions"],
  ["emails_sent", "Emails sent"],
  ["total_users", "Total users"],
  ["revenue", "Revenue"],
]);

export function getGrowthMetricLabel(metricId: GrowthMetricId): string {
  return GROWTH_METRIC_LABELS.get(metricId) ?? throwErr(`GROWTH_METRIC_LABELS is missing an entry for metric ${metricId}; it must cover every GROWTH_METRIC_IDS member`);
}

// Sanity check at module load: a metric id added to the wire enum without a label here should fail
// loudly in tests/dev instead of first surfacing when a user opens the one page that renders it.
for (const metricId of GROWTH_METRIC_IDS) getGrowthMetricLabel(metricId);

function pluralize(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * Human relative time between `targetMillis` and `nowMillis`, e.g. "in 2 hours", "3 days ago",
 * "just now". Uses coarse units on purpose (a background task list doesn't need second precision),
 * and stays relative even for far-away dates so the output never depends on the viewer's locale.
 */
export function formatGrowthRelativeTime(targetMillis: number, nowMillis: number): string {
  const diff = targetMillis - nowMillis;
  const magnitude = Math.abs(diff);
  if (magnitude < MINUTE) return "just now";
  const phrase = magnitude >= DAY
    ? pluralize(Math.round(magnitude / DAY), "day")
    : magnitude >= HOUR
      ? pluralize(Math.round(magnitude / HOUR), "hour")
      : pluralize(Math.round(magnitude / MINUTE), "minute");
  return diff > 0 ? `in ${phrase}` : `${phrase} ago`;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Headline for a brief's ISO day key (YYYY-MM-DD, UTC), e.g. "Tuesday, August 4, 2026". Formatted
 * by hand (not toLocaleDateString) so server and client render the same string regardless of the
 * environment's locale — briefs are keyed by UTC day, and the copy should say exactly that day.
 */
export function formatGrowthBriefDateHeadline(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match == null) return throwErr(`Brief dates are ISO day keys (YYYY-MM-DD) on the wire, got ${JSON.stringify(isoDate)}`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return `${WEEKDAY_NAMES[date.getUTCDay()]}, ${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** Compact threshold display for milestones, e.g. 5000 → "5,000". */
export function formatGrowthThreshold(threshold: number): string {
  return threshold.toLocaleString("en-US");
}

// ─── Catalog-metric value formatting (metrics overview page) ─────────────────

/** "1h 05m", "5m 20s", "42s" — the two most significant units, zero-padding the second one. */
function formatSecondsDuration(totalSeconds: number): string {
  const seconds = Math.round(totalSeconds);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
  }
  return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m`;
}

/**
 * Formats one wide-store metric value by its catalog unit. `cents` values are platform revenue,
 * which is always USD-cents, hence the hardcoded "$". `minor_units` deliberately throws: those
 * values only exist on the ads catalog entries, which carry a per-account currency and must go
 * through formatGrowthAdSpend instead — a currency-less rendering here would be a silent lie.
 */
export function formatGrowthMetricValue(value: number, unit: GrowthCatalogMetricUnit): string {
  switch (unit) {
    case "count": {
      return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
    }
    case "cents": {
      return `$${(value / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    case "percent": {
      return `${value.toFixed(1)}%`;
    }
    case "seconds": {
      return formatSecondsDuration(value);
    }
    case "minor_units": {
      return throwErr("minor_units values carry a per-ad-account currency — format them with formatGrowthAdSpend(spendMinor, currency) instead of formatGrowthMetricValue");
    }
  }
}

const CURRENCY_CODE_RE = /^[A-Za-z]{3}$/;

/**
 * Ad spend in the ACCOUNT's currency: minor units → major units with the currency's own decimal
 * count (2 for USD, 0 for JPY, ...), taken from Intl's currency table so we don't maintain one.
 * An empty/malformed currency code (the store's "platform didn't report one" sentinel) renders the
 * raw number labeled as minor units rather than guessing a conversion.
 */
/**
 * The mandatory timezone caveat for any ad-metrics figure shown on a brief: the brief itself is dated
 * in UTC, but Meta reports a day's spend/impressions/clicks in the AD ACCOUNT's own timezone. Showing
 * a number without this basis silently misattributes which calendar day it actually covers — see
 * GrowthBriefAdMetrics's doc comment in growth-types.ts.
 */
export function formatGrowthAdMetricsTimezoneNote(adDate: string, timezone: string): string {
  return `${adDate} in ${timezone} (ad account time)`;
}

export function formatGrowthAdSpend(spendMinor: number, currency: string): string {
  if (!CURRENCY_CODE_RE.test(currency)) {
    return `${spendMinor.toLocaleString("en-US")} (minor units)`;
  }
  // Intl accepts any well-formed ISO 4217 code (unknown ones default to 2 fraction digits), so the
  // regex guard above is sufficient to keep this constructor from throwing.
  const numberFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() });
  // The TS lib types maximumFractionDigits as optional, but for style: "currency" the spec always
  // resolves it (to the currency's minor-unit count) — so a missing value is an engine bug.
  const fractionDigits = numberFormat.resolvedOptions().maximumFractionDigits
    ?? throwErr(`Intl resolved no maximumFractionDigits for currency ${currency} — style: "currency" formats always resolve fraction digits per spec`);
  return numberFormat.format(spendMinor / Math.pow(10, fractionDigits));
}
