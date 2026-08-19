// Pure data helpers for the before/after metric comparison (no UI imports on purpose: this module is
// unit-tested in node, and keeping it free of component imports keeps the tests independent of the
// design-system package build).

import type { GrowthActionItem, GrowthActionMetricSeries, GrowthMetricId, GrowthMetricPoint } from "@/lib/growth/growth-types";

const DAY_MILLIS = 24 * 60 * 60 * 1000;

export const GROWTH_METRIC_LABELS = new Map<GrowthMetricId, string>([
  ["new_signups", "New signups"],
  ["returning_users", "Returning users"],
  ["transactions", "Transactions"],
  ["emails_sent", "Emails sent"],
  ["total_users", "Total users"],
  ["revenue", "Revenue"],
]);

export function getGrowthMetricLabel(metricId: GrowthMetricId): string {
  return GROWTH_METRIC_LABELS.get(metricId) ?? metricId;
}

/**
 * Relative change of `currentValue` vs `previousValue` as a percentage, rounded to one decimal.
 * Ported from `calculatePeriodDelta` in `(overview)/metrics-page.tsx` with `undefined` mapped to
 * `null` (DesignMetricDelta's "not computable" state): a zero baseline with a non-zero current value
 * has no meaningful percentage, while zero → zero is a true 0% change.
 */
export function computeDeltaPercent(currentValue: number, previousValue: number): number | null {
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) {
    return null;
  }
  if (previousValue === 0) {
    return currentValue === 0 ? 0 : null;
  }
  return Number((((currentValue - previousValue) / previousValue) * 100).toFixed(1));
}

export function sumMetricSeries(points: GrowthMetricPoint[]): number {
  return points.reduce((sum, point) => sum + point.value, 0);
}

export type MetricComparisonRow = {
  /** ISO date (YYYY-MM-DD), UTC. */
  date: string,
  baseline: number | null,
  current: number | null,
};

/**
 * Merges the before/after series onto one date axis so both lines render in a single chart. A date
 * that appears in only one series carries `null` for the other, which recharts renders as a gap (the
 * two windows are usually disjoint in time, so the baseline line ends where the current line begins).
 */
export function mergeMetricSeries(before: GrowthMetricPoint[], after: GrowthMetricPoint[]): MetricComparisonRow[] {
  const rows = new Map<string, MetricComparisonRow>();
  for (const point of before) {
    const existing = rows.get(point.date) ?? { date: point.date, baseline: null, current: null };
    rows.set(point.date, { ...existing, baseline: point.value });
  }
  for (const point of after) {
    const existing = rows.get(point.date) ?? { date: point.date, baseline: null, current: null };
    rows.set(point.date, { ...existing, current: point.value });
  }
  // ISO dates sort lexicographically, so string comparison is a correct date ordering.
  return [...rows.values()].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

// ─── Demo fixtures ───────────────────────────────────────────────────────────

/** ISO date (YYYY-MM-DD, UTC) `daysAgo` full days before `nowMillis` (same convention as growth-demo-data). */
function demoDate(nowMillis: number, daysAgo: number): string {
  return new Date(nowMillis - daysAgo * DAY_MILLIS).toISOString().slice(0, 10);
}

// Deterministic pseudo-noise in [0, 1) — the demo must render identically on every load, so
// Math.random is off the table. The classic sin-hash is plenty for plausible-looking wiggle.
function seededNoise(seed: number, index: number): number {
  const x = Math.sin(seed * 374761.393 + index * 668265.263) * 43758.5453;
  return x - Math.floor(x);
}

function metricSeed(metricId: GrowthMetricId): number {
  let seed = 0;
  for (let i = 0; i < metricId.length; i++) {
    seed = (seed * 31 + metricId.charCodeAt(i)) % 100_000;
  }
  return seed + 1;
}

const DEMO_METRIC_BASE_VALUES = new Map<GrowthMetricId, number>([
  ["new_signups", 18],
  ["returning_users", 52],
  ["transactions", 9],
  ["emails_sent", 120],
  ["total_users", 3400],
  ["revenue", 412],
]);

function demoSeriesValue(metricId: GrowthMetricId, index: number, uplift: number): number {
  const base = DEMO_METRIC_BASE_VALUES.get(metricId) ?? 10;
  const noise = seededNoise(metricSeed(metricId), index);
  // Base wiggle ±15% plus a gentle upward drift so the lines look like real daily metrics.
  const drift = 1 + index * 0.006;
  return Math.round(base * uplift * drift * (0.85 + 0.3 * noise));
}

/**
 * Deterministic before/after metric fixtures for an action's watched metrics. Mirrors the backend's
 * capture semantics: the "before" window is the `windowDays` days leading up to activation (or up to
 * now for unactivated actions — a baseline preview), and the "after" window only exists once the
 * action was activated. The modest ~12% uplift keeps the demo story positive without being absurd.
 */
export function buildGrowthDemoActionMetrics(action: GrowthActionItem, nowMillis: number): GrowthActionMetricSeries[] {
  const activatedAt = action.activatedAtMillis;
  const anchorMillis = activatedAt ?? nowMillis;
  return action.watchedMetrics.map((watched) => {
    const anchorDaysAgo = Math.max(0, Math.floor((nowMillis - anchorMillis) / DAY_MILLIS));
    const before: GrowthMetricPoint[] = [];
    for (let i = watched.windowDays; i >= 1; i--) {
      before.push({
        date: demoDate(nowMillis, anchorDaysAgo + i),
        value: demoSeriesValue(watched.metricId, watched.windowDays - i, 1),
      });
    }
    const after: GrowthMetricPoint[] = [];
    if (activatedAt != null) {
      // Only the days that have already elapsed since activation exist, capped at the window length.
      const elapsedDays = Math.min(watched.windowDays, anchorDaysAgo);
      for (let i = elapsedDays; i >= 1; i--) {
        after.push({
          date: demoDate(nowMillis, i),
          value: demoSeriesValue(watched.metricId, watched.windowDays + (elapsedDays - i), 1.12),
        });
      }
    }
    return {
      metricId: watched.metricId,
      windowDays: watched.windowDays,
      before,
      after,
      beforeCapturedAtMillis: anchorMillis,
      afterCapturedAtMillis: after.length === 0 ? null : nowMillis,
    };
  });
}
