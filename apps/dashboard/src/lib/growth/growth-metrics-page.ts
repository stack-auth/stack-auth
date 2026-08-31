import { throwErr } from "@hexclave/shared/dist/utils/errors";
import {
  GROWTH_CATALOG_METRIC_CATEGORIES,
  type GrowthAdAccountMetricPoint,
  type GrowthCatalogMetricCategory,
  type GrowthCatalogMetricKind,
  type GrowthCatalogMetricUnit,
  type GrowthMetricPoint,
  type GrowthMetricsOverview,
  type GrowthMetricsOverviewMetric,
} from "./growth-types";

// Pure helpers + deterministic demo fixtures for the growth Metrics page. No UI imports on purpose
// (same reasoning as growth/components/metric-comparison-data.ts): this module is unit-tested in
// node, independent of the design-system package build.

const DAY_MILLIS = 24 * 60 * 60 * 1000;
const COMPARISON_WINDOW_DAYS = 30;

// ─── Category grouping ───────────────────────────────────────────────────────

export const GROWTH_METRIC_CATEGORY_LABELS = new Map<GrowthCatalogMetricCategory, string>([
  ["users", "Users"],
  ["engagement", "Engagement"],
  ["web", "Web"],
  ["email", "Email"],
  ["revenue", "Revenue"],
  ["teams", "Teams"],
  ["derived", "Derived"],
]);

// Sanity check at module load, mirroring growth-format.ts's label-map guard: a category added to
// the wire enum without a label here should fail loudly in tests/dev, not render as a blank tab.
for (const category of GROWTH_CATALOG_METRIC_CATEGORIES) {
  if (!GROWTH_METRIC_CATEGORY_LABELS.has(category)) {
    throwErr(`GROWTH_METRIC_CATEGORY_LABELS is missing an entry for category ${category}; it must cover every GROWTH_CATALOG_METRIC_CATEGORIES member`);
  }
}

/**
 * Groups metrics by category in the canonical GROWTH_CATALOG_METRIC_CATEGORIES order, preserving
 * the metrics' own (catalog) order within each category. Categories with no metrics are omitted so
 * the page never renders an empty tab.
 */
export function groupGrowthMetricsByCategory(metrics: GrowthMetricsOverviewMetric[]): Map<GrowthCatalogMetricCategory, GrowthMetricsOverviewMetric[]> {
  const groups = new Map<GrowthCatalogMetricCategory, GrowthMetricsOverviewMetric[]>();
  for (const category of GROWTH_CATALOG_METRIC_CATEGORIES) {
    const inCategory = metrics.filter((metric) => metric.category === category);
    if (inCategory.length > 0) groups.set(category, inCategory);
  }
  return groups;
}

// ─── Period-over-period summaries ────────────────────────────────────────────

function dayKeyToMillis(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match == null) return throwErr(`Metric series dates are ISO day keys (YYYY-MM-DD) on the wire, got ${JSON.stringify(date)}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * Relative change of `currentValue` vs `previousValue` as a percentage, rounded to one decimal.
 * Same null semantics as computeDeltaPercent in growth/components/metric-comparison-data.ts (the
 * canonical derivation from the overview page's calculatePeriodDelta): a zero baseline with a
 * non-zero current value has no meaningful percentage, while zero → zero is a true 0% change.
 * Duplicated rather than imported because lib/ must not depend on app/ routing modules.
 */
export function computeGrowthOverviewDeltaPercent(currentValue: number, previousValue: number): number | null {
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) {
    return null;
  }
  if (previousValue === 0) {
    return currentValue === 0 ? 0 : null;
  }
  return Number((((currentValue - previousValue) / previousValue) * 100).toFixed(1));
}

export type GrowthMetricSummary = {
  /** The value the stat tile shows (30d aggregate for flows, latest snapshot value otherwise). */
  primaryValue: number,
  /** null = not computable (no baseline window data) — DesignMetricDelta renders this honestly. */
  delta: number | null,
  /** Short copy describing what primaryValue and delta cover, e.g. "Last 30 days vs the 30 days before". */
  label: string,
  comparisonLabel: string,
};

/** Summing percentages or durations across days is meaningless — those flows aggregate by mean. */
function aggregateFlowWindow(points: GrowthMetricPoint[], unit: GrowthCatalogMetricUnit): number {
  const sum = points.reduce((total, point) => total + point.value, 0);
  return unit === "percent" || unit === "seconds" ? sum / points.length : sum;
}

/**
 * Period-over-period summary for one metric, anchored at its own latest stored day (not "today":
 * a store whose rollup paused should compare its last two real windows, not windows full of gaps).
 *
 * - flow: last 30 days vs the 30 days before, aggregated by sum (count/cents) or mean (percent/
 *   seconds). Delta is null when the prior window has no points at all.
 * - snapshot: latest value vs the newest point at least 30 days older. Delta is null when the
 *   store has no such point yet (fewer than 30 days of history).
 *
 * Returns null for an empty series — the caller renders a per-metric empty state instead.
 */
export function summarizeGrowthMetric(metric: {
  kind: GrowthCatalogMetricKind,
  unit: GrowthCatalogMetricUnit,
  series: GrowthMetricPoint[],
}): GrowthMetricSummary | null {
  const series = metric.series;
  if (series.length === 0) return null;
  const anchorMillis = dayKeyToMillis(series[series.length - 1].date);

  if (metric.kind === "flow") {
    const windowStart = anchorMillis - (COMPARISON_WINDOW_DAYS - 1) * DAY_MILLIS;
    const previousStart = windowStart - COMPARISON_WINDOW_DAYS * DAY_MILLIS;
    const currentPoints = series.filter((point) => dayKeyToMillis(point.date) >= windowStart);
    const previousPoints = series.filter((point) => {
      const millis = dayKeyToMillis(point.date);
      return millis >= previousStart && millis < windowStart;
    });
    // currentPoints always contains at least the anchor point, so the aggregate is well-defined.
    const current = aggregateFlowWindow(currentPoints, metric.unit);
    const isMean = metric.unit === "percent" || metric.unit === "seconds";
    return {
      primaryValue: current,
      delta: previousPoints.length === 0 ? null : computeGrowthOverviewDeltaPercent(current, aggregateFlowWindow(previousPoints, metric.unit)),
      label: isMean ? "Last 30 days (avg)" : "Last 30 days",
      comparisonLabel: "vs the 30 days before",
    };
  }

  const latest = series[series.length - 1];
  const baselineCutoff = anchorMillis - COMPARISON_WINDOW_DAYS * DAY_MILLIS;
  // The series is sorted ascending, so the last point at or before the cutoff is the newest one.
  let baseline: GrowthMetricPoint | null = null;
  for (const point of series) {
    if (dayKeyToMillis(point.date) <= baselineCutoff) baseline = point;
  }
  return {
    primaryValue: latest.value,
    delta: baseline == null ? null : computeGrowthOverviewDeltaPercent(latest.value, baseline.value),
    label: "Current",
    comparisonLabel: `as of ${latest.date} · vs 30 days ago`,
  };
}

/** "2026-08-04" → "Aug 4" for chart axis ticks; non-day-key strings pass through untouched. */
export function formatGrowthMetricDayTick(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const parsed = new Date(dayKeyToMillis(date));
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][parsed.getUTCMonth()];
  return `${month} ${parsed.getUTCDate()}`;
}

// ─── Demo fixtures ───────────────────────────────────────────────────────────
// Local to this page on purpose: growth-demo-data.ts owns the lifecycle-wide fixtures and is
// edited independently, so the metrics-page fixtures live here to keep the two decoupled.

/** ISO date (YYYY-MM-DD, UTC) `daysAgo` full days before `nowMillis` (same convention as growth-demo-data). */
function demoDate(nowMillis: number, daysAgo: number): string {
  return new Date(nowMillis - daysAgo * DAY_MILLIS).toISOString().slice(0, 10);
}

// Deterministic pseudo-noise in [0, 1) — the demo must render identically on every load, so
// Math.random is off the table. Same sin-hash idiom as the action-detail demo metrics.
function seededNoise(seed: number, index: number): number {
  const x = Math.sin(seed * 374761.393 + index * 668265.263) * 43758.5453;
  return x - Math.floor(x);
}

function stringSeed(value: string): number {
  let seed = 0;
  for (let i = 0; i < value.length; i++) {
    seed = (seed * 31 + value.charCodeAt(i)) % 100_000;
  }
  return seed + 1;
}

type DemoMetricSpec = {
  id: string,
  label: string,
  unit: GrowthCatalogMetricUnit,
  category: GrowthCatalogMetricCategory,
  kind: GrowthCatalogMetricKind,
  description: string,
  base: number,
  /** Multiplier applied across the window so trends read as growth (>1) or decline (<1). */
  drift: number,
  /** Days of history to fabricate; short histories demo the "not enough data for a delta" state. */
  days: number,
};

// A representative slice of the stored catalog: every category is covered, every unit appears, and
// a couple of entries have deliberately thin/empty histories so the page's per-metric empty and
// no-baseline states are demoable without hand-editing data.
const DEMO_METRIC_SPECS: DemoMetricSpec[] = [
  { id: "total_users", label: "Total users", unit: "count", category: "users", kind: "snapshot", description: "All-time count of non-anonymous, non-deleted users as of the rollup.", base: 3400, drift: 1.4, days: 90 },
  { id: "new_users", label: "New users", unit: "count", category: "users", kind: "flow", description: "Non-anonymous users who signed up on that UTC day.", base: 18, drift: 1.5, days: 90 },
  { id: "verified_users", label: "Verified users", unit: "count", category: "users", kind: "snapshot", description: "Non-anonymous users with a verified primary email, as of the rollup.", base: 2600, drift: 1.4, days: 21 },
  { id: "dau", label: "Daily active users", unit: "count", category: "engagement", kind: "flow", description: "Distinct non-anonymous users with at least one session on that UTC day.", base: 260, drift: 1.3, days: 90 },
  { id: "mau", label: "Monthly active users", unit: "count", category: "engagement", kind: "snapshot", description: "Distinct non-anonymous users active in the trailing 30 days, as of the rollup.", base: 1900, drift: 1.2, days: 90 },
  { id: "page_views", label: "Page views", unit: "count", category: "web", kind: "flow", description: "Page-view events on that UTC day, from non-anonymous users.", base: 5200, drift: 1.35, days: 90 },
  { id: "visitors", label: "Visitors", unit: "count", category: "web", kind: "flow", description: "Distinct non-anonymous users with at least one page view on that UTC day.", base: 900, drift: 1.3, days: 90 },
  { id: "bounce_rate", label: "Bounce rate", unit: "percent", category: "web", kind: "flow", description: "Share of sessions on that day with exactly one page view, 0-100.", base: 52, drift: 0.9, days: 90 },
  { id: "avg_session_seconds", label: "Average session length", unit: "seconds", category: "web", kind: "flow", description: "Mean session duration in seconds for sessions starting that day.", base: 340, drift: 1.1, days: 90 },
  // Empty on purpose: demos the per-metric "no rows in the window" card state.
  { id: "clicks", label: "Clicks", unit: "count", category: "web", kind: "flow", description: "Click events on that UTC day, from non-anonymous users. Requires the analytics app.", base: 800, drift: 1, days: 0 },
  { id: "emails_created", label: "Emails created", unit: "count", category: "email", kind: "flow", description: "Outbox email rows created on that UTC day, across all statuses.", base: 140, drift: 1.25, days: 90 },
  { id: "email_deliverability_rate", label: "Email deliverability rate", unit: "percent", category: "email", kind: "snapshot", description: "All-time delivered / finished-sending, 0-100, as of the rollup.", base: 98.4, drift: 1, days: 90 },
  { id: "revenue_cents", label: "Revenue", unit: "cents", category: "revenue", kind: "flow", description: "Paid subscription-invoice revenue in cents, by invoice creation day (UTC).", base: 41200, drift: 1.45, days: 90 },
  { id: "active_subscriptions", label: "Active subscriptions", unit: "count", category: "revenue", kind: "snapshot", description: "Subscriptions currently in status active, as of the rollup.", base: 57, drift: 1.35, days: 90 },
  { id: "mrr_cents_proxy", label: "MRR (proxy)", unit: "cents", category: "revenue", kind: "snapshot", description: "Trailing-30-day paid invoice revenue in cents as of the rollup — a proxy, not true MRR.", base: 920000, drift: 1.3, days: 90 },
  { id: "active_teams", label: "Active teams", unit: "count", category: "teams", kind: "flow", description: "Distinct teams with at least one member session on that UTC day.", base: 34, drift: 1.2, days: 90 },
  { id: "total_teams", label: "Total teams", unit: "count", category: "teams", kind: "snapshot", description: "All-time count of non-deleted teams as of the rollup.", base: 86, drift: 1.25, days: 90 },
  { id: "visitor_signup_rate", label: "Visitor signup rate", unit: "percent", category: "derived", kind: "flow", description: "new_users / visitors * 100 for that day; days with zero visitors have no row.", base: 2.1, drift: 1.15, days: 90 },
  { id: "dau_mau_stickiness", label: "DAU/MAU stickiness", unit: "percent", category: "derived", kind: "snapshot", description: "Latest-day DAU divided by trailing-30-day MAU, 0-100, as of the rollup.", base: 14, drift: 1.1, days: 90 },
];

function demoSeries(spec: DemoMetricSpec, nowMillis: number): GrowthMetricPoint[] {
  const seed = stringSeed(spec.id);
  const series: GrowthMetricPoint[] = [];
  for (let daysAgo = spec.days - 1; daysAgo >= 0; daysAgo--) {
    const index = spec.days - 1 - daysAgo;
    const progress = spec.days <= 1 ? 1 : index / (spec.days - 1);
    // Snapshot series wiggle less (state drifts smoothly); flow series get ±15% daily noise.
    const noiseAmplitude = spec.kind === "snapshot" ? 0.04 : 0.3;
    const noise = 1 - noiseAmplitude / 2 + noiseAmplitude * seededNoise(seed, index);
    const trended = spec.base * (1 + (spec.drift - 1) * progress) * noise;
    const value = spec.unit === "percent" ? Number(trended.toFixed(1)) : Math.round(trended);
    series.push({ date: demoDate(nowMillis, daysAgo), value });
  }
  return series;
}

export const GROWTH_DEMO_AD_ACCOUNT = {
  accountId: "act_918273645",
  accountTimezone: "America/Los_Angeles",
  currency: "USD",
} as const;

function demoAdSeries(nowMillis: number): GrowthAdAccountMetricPoint[] {
  const spendSeed = stringSeed("demo_ad_spend");
  const series: GrowthAdAccountMetricPoint[] = [];
  for (let daysAgo = 89; daysAgo >= 0; daysAgo--) {
    const index = 89 - daysAgo;
    const noise = 0.85 + 0.3 * seededNoise(spendSeed, index);
    const spendMinor = Math.round(2500 * (1 + index * 0.004) * noise);
    // Impressions/clicks derived from spend so the three series correlate like real ad delivery.
    const impressions = Math.round(spendMinor * 2.2 * (0.9 + 0.2 * seededNoise(spendSeed, index + 1000)));
    const clicks = Math.round(impressions * 0.024 * (0.85 + 0.3 * seededNoise(spendSeed, index + 2000)));
    series.push({ date: demoDate(nowMillis, daysAgo), spendMinor, impressions, clicks });
  }
  return series;
}

/**
 * Deterministic fixture for the whole metrics-overview payload: all categories covered, one ad
 * account (so the account-timezone caption is demoable), and a couple of thin/empty series for the
 * degraded states. Same `nowMillis` in → identical payload out, on every load.
 */
export function buildGrowthDemoMetricsOverview(nowMillis: number): GrowthMetricsOverview {
  const metrics: GrowthMetricsOverviewMetric[] = DEMO_METRIC_SPECS.map((spec) => {
    const series = demoSeries(spec, nowMillis);
    return {
      id: spec.id,
      label: spec.label,
      unit: spec.unit,
      category: spec.category,
      kind: spec.kind,
      description: spec.description,
      latest: series.length === 0 ? null : series[series.length - 1],
      series,
    };
  });
  return {
    windowDays: 90,
    latestStoredDate: demoDate(nowMillis, 0),
    metrics,
    adAccounts: [{
      accountId: GROWTH_DEMO_AD_ACCOUNT.accountId,
      accountTimezone: GROWTH_DEMO_AD_ACCOUNT.accountTimezone,
      currency: GROWTH_DEMO_AD_ACCOUNT.currency,
      series: demoAdSeries(nowMillis),
    }],
  };
}
