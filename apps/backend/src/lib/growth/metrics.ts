import type { ActivitySplit } from "@/lib/metrics-activity-split";
import {
  loadAuthOverview,
  loadDailyRevenue,
  loadEmailOverview,
  loadPaymentsOverview,
  loadTotalUsers,
  METRICS_WINDOW_DAYS,
} from "@/lib/metrics/loaders";
import type { Tenancy } from "@/lib/tenancies";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import type { GrowthMetricId } from "./action-item-types";

export type GrowthDailyPoint = { date: string, value: number };

type ActivityPoint = { date: string, activity: number };

// ── Pure aggregation helpers (unit-tested in metrics.test.ts) ────────────────

export function sumActivity(points: ActivityPoint[]): number {
  return points.reduce((acc, point) => acc + point.activity, 0);
}

export function toGrowthSeries(points: ActivityPoint[]): GrowthDailyPoint[] {
  return points.map((point) => ({ date: point.date, value: point.activity }));
}

/**
 * Per-day count of returning active users: users active on a day who were NOT first seen that day
 * (retained = also active the previous day, reactivated = active after a gap). The three split
 * series come from the same query and are always date-aligned; assert that instead of silently
 * zipping mismatched arrays.
 */
export function buildReturningUsersSeries(split: ActivitySplit): GrowthDailyPoint[] {
  if (split.retained.length !== split.reactivated.length) {
    throw new HexclaveAssertionError("ActivitySplit series must be date-aligned — retained and reactivated came from the same GROUP BY, so differing lengths mean the loader changed shape.", { split });
  }
  return split.retained.map((point, index) => {
    const reactivated = split.reactivated[index];
    if (reactivated.date !== point.date) {
      throw new HexclaveAssertionError("ActivitySplit series must share dates at each index.", { retainedDate: point.date, reactivatedDate: reactivated.date });
    }
    return { date: point.date, value: point.activity + reactivated.activity };
  });
}

/**
 * Turns a per-day signup series into a cumulative total-users series anchored at the current total:
 * the last day's value equals `currentTotal`, and each earlier day subtracts the signups that
 * happened after it. This reconstructs the total-users curve without needing a per-day snapshot
 * table (deleted users make the reconstruction approximate, which is fine for trend display).
 */
export function buildCumulativeTotalUsersSeries(dailySignups: ActivityPoint[], currentTotal: number): GrowthDailyPoint[] {
  const result: GrowthDailyPoint[] = new Array(dailySignups.length);
  let runningTotal = currentTotal;
  for (let i = dailySignups.length - 1; i >= 0; i--) {
    result[i] = { date: dailySignups[i].date, value: runningTotal };
    runningTotal -= dailySignups[i].activity;
  }
  return result;
}

export function takeLastDays(series: GrowthDailyPoint[], days: number): GrowthDailyPoint[] {
  if (!Number.isInteger(days) || days < 1) {
    throw new HexclaveAssertionError(`takeLastDays requires a positive integer day count, got ${days}.`);
  }
  if (days > series.length) {
    throw new HexclaveAssertionError(`Requested ${days} days but the underlying metrics window only has ${series.length} points — callers must clamp to the metrics window (${METRICS_WINDOW_DAYS} days).`);
  }
  return series.slice(series.length - days);
}

// ── Loader plumbing ──────────────────────────────────────────────────────────

// Growth metrics never count anonymous users: milestones and watched metrics should reflect real
// humans, matching the dashboard's default (include_anonymous=false) view of the same numbers.
// Exported so metric-store.ts can apply the exact same policy to the loaders it adds on top
// (analytics overview, backfill queries) — the wide metric rows must agree with the legacy 6.
export const GROWTH_METRICS_INCLUDE_ANONYMOUS = false;

/**
 * The five loader outputs every growth-metric computation is derived from. `loadGrowthMetricBundle`
 * in metric-store.ts extends this with the analytics overview; the `...FromBundle` variants below
 * accept anything carrying these fields so callers that already loaded a bundle never double-load.
 */
export type GrowthMetricSources = {
  authOverview: Awaited<ReturnType<typeof loadAuthOverview>>,
  paymentsOverview: Awaited<ReturnType<typeof loadPaymentsOverview>>,
  emailOverview: Awaited<ReturnType<typeof loadEmailOverview>>,
  dailySignups: Awaited<ReturnType<typeof loadTotalUsers>>,
  dailyRevenue: Awaited<ReturnType<typeof loadDailyRevenue>>,
};

export async function loadGrowthMetricSources(tenancy: Tenancy, now: Date): Promise<GrowthMetricSources> {
  const [authOverview, paymentsOverview, emailOverview, dailySignups, dailyRevenue] = await Promise.all([
    loadAuthOverview(tenancy, GROWTH_METRICS_INCLUDE_ANONYMOUS, now),
    loadPaymentsOverview(tenancy, now),
    loadEmailOverview(tenancy, now),
    loadTotalUsers(tenancy, now, GROWTH_METRICS_INCLUDE_ANONYMOUS),
    loadDailyRevenue(tenancy, now),
  ]);
  return { authOverview, paymentsOverview, emailOverview, dailySignups, dailyRevenue };
}

/**
 * Current scalar value for every growth metric. Mapping choices (all reuse the extracted internal
 * metrics loaders so growth numbers always match what the dashboard metrics pages show):
 *
 * - total_users:     loadAuthOverview().total_users_filtered — all-time non-anonymous user count.
 * - new_signups:     sum of loadTotalUsers() daily signup counts — signups in the trailing
 *                    30-day metrics window (an all-time number would just duplicate total_users).
 * - returning_users: sum of retained+reactivated from loadAuthOverview().daily_active_users_split
 *                    over the window — "returning active user-days", i.e. what the returning-users
 *                    daily series sums to; a user returning on several days counts each day.
 * - transactions:    loadPaymentsOverview().total_orders — all-time one-time purchases plus
 *                    subscription invoices, the closest thing to a payment-transaction count.
 * - emails_sent:     loadEmailOverview().emails_sent — all-time finished sends (finishedSendingAt
 *                    set), not merely enqueued outbox rows.
 * - revenue:         sum of loadDailyRevenue() new_cents — paid/succeeded invoice revenue in cents
 *                    over the trailing 30-day window (window-scoped so milestone thresholds track
 *                    momentum rather than lifetime totals).
 */
export async function computeGrowthMetrics(tenancy: Tenancy, now: Date): Promise<Record<GrowthMetricId, number>> {
  return computeGrowthMetricsFromBundle(await loadGrowthMetricSources(tenancy, now));
}

/**
 * Pure variant of computeGrowthMetrics for callers that already hold the loader outputs (e.g. the
 * metric-store rollup, which loads one bundle and derives both the legacy 6 and the wide per-day
 * rows from it). Must stay byte-for-byte output-compatible with the loading variant.
 */
export function computeGrowthMetricsFromBundle(sources: GrowthMetricSources): Record<GrowthMetricId, number> {
  const { authOverview, paymentsOverview, emailOverview, dailySignups, dailyRevenue } = sources;
  return {
    new_signups: sumActivity(dailySignups),
    returning_users: buildReturningUsersSeries(authOverview.daily_active_users_split).reduce((acc, point) => acc + point.value, 0),
    transactions: paymentsOverview.total_orders,
    emails_sent: emailOverview.emails_sent,
    total_users: authOverview.total_users_filtered,
    revenue: dailyRevenue.reduce((acc, point) => acc + point.new_cents, 0),
  };
}

/**
 * Daily series for every growth metric, covering the last `days` days (1..METRICS_WINDOW_DAYS+1 —
 * the loaders only retain a 30-day window, so longer ranges are a programming error). Mapping
 * choices per metric are documented alongside computeGrowthMetrics; the series-specific ones:
 *
 * - transactions:  loadPaymentsOverview().daily_subscriptions (subscriptions created per day) —
 *                  the only per-day payments series the loaders expose today; one-time purchases
 *                  have no daily breakdown yet, so this undercounts but trends correctly.
 * - emails_sent:   loadEmailOverview().daily_emails — outbox rows created per day (the loaders
 *                  have no per-day finished-send breakdown; creation date is the same-day proxy).
 * - total_users:   cumulative reconstruction anchored at the current total, see
 *                  buildCumulativeTotalUsersSeries.
 * - revenue:       loadDailyRevenue() new_cents per day, in cents.
 */
export async function computeGrowthDailySeries(tenancy: Tenancy, now: Date, days: number): Promise<Record<GrowthMetricId, GrowthDailyPoint[]>> {
  return computeGrowthDailySeriesFromBundle(await loadGrowthMetricSources(tenancy, now), days);
}

/** Pure variant of computeGrowthDailySeries; see computeGrowthMetricsFromBundle for the rationale. */
export function computeGrowthDailySeriesFromBundle(sources: GrowthMetricSources, days: number): Record<GrowthMetricId, GrowthDailyPoint[]> {
  const { authOverview, paymentsOverview, emailOverview, dailySignups, dailyRevenue } = sources;
  return {
    new_signups: takeLastDays(toGrowthSeries(dailySignups), days),
    returning_users: takeLastDays(buildReturningUsersSeries(authOverview.daily_active_users_split), days),
    transactions: takeLastDays(toGrowthSeries(paymentsOverview.daily_subscriptions), days),
    emails_sent: takeLastDays(toGrowthSeries(emailOverview.daily_emails), days),
    total_users: takeLastDays(buildCumulativeTotalUsersSeries(dailySignups, authOverview.total_users_filtered), days),
    revenue: takeLastDays(dailyRevenue.map((point) => ({ date: point.date, value: point.new_cents })), days),
  };
}
