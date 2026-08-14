import { Prisma } from "@/generated/prisma/client";
import { getClickhouseAdminClient } from "@/lib/clickhouse";
import type { ActivitySplit } from "@/lib/metrics-activity-split";
import {
  getMetricsWindowBounds,
  loadAnalyticsOverview,
  METRICS_REVENUE_INVOICE_STATUSES,
} from "@/lib/metrics/loaders";
import type { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, sqlQuoteIdent } from "@/prisma-client";
import type { MetricsDataPoint } from "@hexclave/shared/dist/interface/admin-metrics";
import { captureError, HexclaveAssertionError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { Result } from "@hexclave/shared/dist/utils/results";
import type { GrowthMetricId } from "./action-item-types";
import {
  buildCumulativeTotalUsersSeries,
  buildReturningUsersSeries,
  computeGrowthMetricsFromBundle,
  GROWTH_METRICS_INCLUDE_ANONYMOUS,
  loadGrowthMetricSources,
  type GrowthMetricSources,
} from "./metrics";

/**
 * The write path for the wide per-day growth metric store (ClickHouse
 * `analytics_internal.growth_daily_metrics` / `growth_daily_ad_metrics`; see
 * scripts/clickhouse-migrations.ts for the DDL and src/lib/growth/metric-catalog.ts for the metric
 * vocabulary). One bundle load feeds both the legacy 6 growth metrics and the wide rows, so the
 * two can never disagree about the same instant.
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ClickHouse DateTime params are passed as "YYYY-MM-DDTHH:MM:SS" (no timezone); treat them as UTC.
// (Same convention as the private helper in lib/metrics/loaders.tsx.)
function formatClickhouseDateTimeParam(date: Date): string {
  return date.toISOString().slice(0, 19);
}

function toUtcDayKey(date: Date): string {
  return date.toISOString().split("T")[0];
}

/** One row of analytics_internal.growth_daily_metrics, field names matching the JSONEachRow insert. */
export type GrowthDailyMetricRow = {
  project_id: string,
  branch_id: string,
  date: string, // YYYY-MM-DD, UTC day
  metric_id: string,
  value: number,
};

/**
 * The flat projection of the loader outputs that `buildGrowthMetricRows` consumes. Kept separate
 * from the raw loader outputs (which are huge and awkward to construct in tests) so the row
 * builder stays a pure function over an explicitly-typed, fixture-friendly input.
 */
export type GrowthMetricRowSources = {
  projectId: string,
  branchId: string,
  // flow series (each covers the loaders' 31-day window, zero-filled by the loaders)
  dailySignups: MetricsDataPoint[],
  dailyActiveUsersSplit: ActivitySplit,
  dailyActiveTeamsSplit: ActivitySplit,
  dailyPageViews: MetricsDataPoint[],
  dailyClicks: MetricsDataPoint[],
  dailyVisitors: MetricsDataPoint[],
  dailyBounceRate: MetricsDataPoint[],
  dailyAvgSessionSeconds: MetricsDataPoint[],
  dailyEmailsByStatus: { date: string, ok: number, error: number, in_progress: number }[],
  dailyRevenue: { date: string, new_cents: number, refund_cents: number }[],
  dailySubscriptions: MetricsDataPoint[],
  // snapshots (state as of the bundle load)
  totalUsersFiltered: number,
  mau: number,
  verifiedUsers: number,
  unverifiedUsers: number,
  anonymousUsers: number,
  totalTeams: number,
  emailsSentTotal: number,
  emailDeliverabilityRate: number,
  emailBounceRate: number,
  emailClickRate: number,
  activeSubscriptions: number,
  canceledSubscriptions: number,
  mrrCentsProxy: number,
  totalOrders: number,
  totalOneTimePurchases: number,
  checkoutConversionRate: number,
};

/**
 * Everything one rollup pass needs: the raw legacy loader outputs (so `computeGrowthMetricsFromBundle`
 * and `computeGrowthDailySeriesFromBundle` can run without reloading), the analytics overview, the
 * flat row-builder projection, and the legacy 6 record itself.
 */
export type GrowthMetricBundle = GrowthMetricSources & GrowthMetricRowSources & {
  now: Date,
  analyticsOverview: Awaited<ReturnType<typeof loadAnalyticsOverview>>,
  legacyMetrics: Record<GrowthMetricId, number>,
};

/**
 * ONE loading pass for everything metric-shaped: the five legacy growth loaders plus the analytics
 * overview, all in parallel. includeAnonymous is pinned to the growth policy (false) so the wide
 * rows agree with the legacy 6 and with the dashboard's default view of the same numbers.
 */
export async function loadGrowthMetricBundle(tenancy: Tenancy, now: Date): Promise<GrowthMetricBundle> {
  const [sources, analyticsOverview] = await Promise.all([
    loadGrowthMetricSources(tenancy, now),
    // No breakdown filters: the stored rows are the unfiltered totals; sliced views stay on-the-fly.
    loadAnalyticsOverview(tenancy, now, GROWTH_METRICS_INCLUDE_ANONYMOUS),
  ]);
  const { authOverview, paymentsOverview, emailOverview } = sources;
  return {
    ...sources,
    now,
    analyticsOverview,
    legacyMetrics: computeGrowthMetricsFromBundle(sources),
    projectId: tenancy.project.id,
    branchId: tenancy.branchId,
    dailyActiveUsersSplit: authOverview.daily_active_users_split,
    dailyActiveTeamsSplit: authOverview.daily_active_teams_split,
    dailyPageViews: analyticsOverview.daily_page_views,
    dailyClicks: analyticsOverview.daily_clicks,
    dailyVisitors: analyticsOverview.daily_visitors,
    dailyBounceRate: analyticsOverview.daily_bounce_rate,
    dailyAvgSessionSeconds: analyticsOverview.daily_avg_session_seconds,
    dailyEmailsByStatus: emailOverview.daily_emails_by_status,
    dailySubscriptions: paymentsOverview.daily_subscriptions,
    totalUsersFiltered: authOverview.total_users_filtered,
    mau: authOverview.mau,
    verifiedUsers: authOverview.verified_users,
    unverifiedUsers: authOverview.unverified_users,
    anonymousUsers: authOverview.anonymous_users,
    totalTeams: authOverview.total_teams,
    emailsSentTotal: emailOverview.emails_sent,
    emailDeliverabilityRate: emailOverview.deliverability_rate,
    emailBounceRate: emailOverview.bounce_rate,
    emailClickRate: emailOverview.click_rate,
    activeSubscriptions: paymentsOverview.active_subscription_count,
    canceledSubscriptions: paymentsOverview.subscriptions_by_status["canceled"] ?? 0,
    mrrCentsProxy: paymentsOverview.mrr_cents,
    totalOrders: paymentsOverview.total_orders,
    totalOneTimePurchases: paymentsOverview.total_one_time_purchases,
    checkoutConversionRate: paymentsOverview.checkout_conversion_rate,
  };
}

/**
 * PURE: turns one bundle into the growth_daily_metrics rows for one rollup pass.
 *
 * Flow metrics emit rows for the FULL window the loaders provide (31 days), not just targetDate:
 * re-emitting the overlap every day is the self-healing mechanism — late-arriving events, email
 * status settles, or a day the rollup was down all get corrected on the next pass, and
 * ReplacingMergeTree(computed_at) + the FINAL view make the re-emission invisible to readers.
 * Snapshot metrics emit exactly one row, for targetDate.
 */
export function buildGrowthMetricRows(bundle: GrowthMetricRowSources, targetDate: string): GrowthDailyMetricRow[] {
  if (!DATE_RE.test(targetDate)) {
    throwErr(`buildGrowthMetricRows targetDate must be a YYYY-MM-DD string, got ${JSON.stringify(targetDate)}.`);
  }
  const rows: GrowthDailyMetricRow[] = [];
  // Non-finite values are SKIPPED rather than stored as 0: a missing row honestly says "we could
  // not compute this metric for this day", while a fabricated 0 would poison trend lines, WoW
  // growth, and any agent reasoning built on top. A skipped day heals itself on a later rollup if
  // the inputs recover (see the flow-window comment above).
  const push = (metricId: string, date: string, value: number) => {
    if (!Number.isFinite(value)) return;
    rows.push({ project_id: bundle.projectId, branch_id: bundle.branchId, date, metric_id: metricId, value });
  };
  const pushSeries = (metricId: string, series: MetricsDataPoint[]) => {
    for (const point of series) push(metricId, point.date, point.activity);
  };

  // — flow metrics —
  pushSeries("new_users", bundle.dailySignups);
  pushSeries("dau", bundle.dailyActiveUsersSplit.total);
  pushSeries("retained_users", bundle.dailyActiveUsersSplit.retained);
  pushSeries("reactivated_users", bundle.dailyActiveUsersSplit.reactivated);
  for (const point of buildReturningUsersSeries(bundle.dailyActiveUsersSplit)) {
    push("returning_users_daily", point.date, point.value);
  }
  pushSeries("new_teams", bundle.dailyActiveTeamsSplit.new);
  pushSeries("active_teams", bundle.dailyActiveTeamsSplit.total);
  pushSeries("page_views", bundle.dailyPageViews);
  pushSeries("clicks", bundle.dailyClicks);
  pushSeries("visitors", bundle.dailyVisitors);
  pushSeries("bounce_rate", bundle.dailyBounceRate);
  pushSeries("avg_session_seconds", bundle.dailyAvgSessionSeconds);
  for (const day of bundle.dailyEmailsByStatus) {
    push("emails_created", day.date, day.ok + day.error + day.in_progress);
    push("emails_ok", day.date, day.ok);
    push("emails_error", day.date, day.error);
  }
  for (const day of bundle.dailyRevenue) {
    push("revenue_cents", day.date, day.new_cents);
    push("refund_cents", day.date, day.refund_cents);
  }
  pushSeries("new_subscriptions", bundle.dailySubscriptions);

  // visitor_signup_rate: null-safe division — a zero-visitor day gets NO row (skipping beats
  // storing 0 or Infinity: 0% would claim "traffic converted nothing" on a day with no traffic).
  const signupsByDate = new Map(bundle.dailySignups.map((point) => [point.date, point.activity]));
  for (const visitorDay of bundle.dailyVisitors) {
    if (visitorDay.activity <= 0) continue;
    const signups = signupsByDate.get(visitorDay.date);
    if (signups == null) continue; // day outside the signup window — can't compute a rate one-sided
    push("visitor_signup_rate", visitorDay.date, (signups / visitorDay.activity) * 100);
  }

  // — snapshot metrics (targetDate only) —
  push("total_users", targetDate, bundle.totalUsersFiltered);
  push("mau", targetDate, bundle.mau);
  push("verified_users", targetDate, bundle.verifiedUsers);
  push("unverified_users", targetDate, bundle.unverifiedUsers);
  push("anonymous_users", targetDate, bundle.anonymousUsers);
  push("total_teams", targetDate, bundle.totalTeams);
  push("emails_sent_total", targetDate, bundle.emailsSentTotal);
  push("email_deliverability_rate", targetDate, bundle.emailDeliverabilityRate);
  push("email_bounce_rate", targetDate, bundle.emailBounceRate);
  push("email_click_rate", targetDate, bundle.emailClickRate);
  push("active_subscriptions", targetDate, bundle.activeSubscriptions);
  push("canceled_subscriptions", targetDate, bundle.canceledSubscriptions);
  push("mrr_cents_proxy", targetDate, bundle.mrrCentsProxy);
  push("total_orders", targetDate, bundle.totalOrders);
  push("total_one_time_purchases", targetDate, bundle.totalOneTimePurchases);
  push("checkout_conversion_rate", targetDate, bundle.checkoutConversionRate);

  // dau_mau_stickiness: snapshot ratio of targetDate's DAU to the trailing-30d MAU. mau === 0
  // yields no row (the division guard below, plus the Number.isFinite guard as a backstop).
  if (bundle.mau > 0) {
    const targetDau = bundle.dailyActiveUsersSplit.total.find((point) => point.date === targetDate);
    if (targetDau != null) {
      push("dau_mau_stickiness", targetDate, (targetDau.activity / bundle.mau) * 100);
    }
  }

  return rows;
}

export async function insertGrowthDailyMetricRows(rows: GrowthDailyMetricRow[]): Promise<void> {
  if (rows.length === 0) return;
  const clickhouseClient = getClickhouseAdminClient();
  await clickhouseClient.insert({
    table: "analytics_internal.growth_daily_metrics",
    values: rows,
    format: "JSONEachRow",
    // Same settings idiom as the event insert in src/lib/events.tsx: best_effort date parsing and
    // async_insert so small periodic batches don't create a part per insert.
    clickhouse_settings: {
      date_time_input_format: "best_effort",
      async_insert: 1,
    },
  });
}

// The `growth_daily_ad_metrics` ClickHouse table (see clickhouse-migrations.ts) and its
// metric-catalog entries exist, but nothing writes to them yet: the writer needs an ad platform
// read connector, which lands with the ad platform integration. Until then the table is simply
// empty, and the catalog's ad metrics read as "no data" rather than being absent — which is what
// the growth agent's SQL surface already handles for any metric with no rows yet.

// ── One-time history backfill ────────────────────────────────────────────────

const BACKFILL_WINDOW_DAYS = 365;

// Same literal-list idiom as METRICS_REVENUE_INVOICE_STATUSES_SQL in lib/metrics/loaders.tsx
// (which is module-private there); safe to Prisma.raw because the statuses are a hardcoded const.
const REVENUE_STATUSES_SQL = Prisma.raw(METRICS_REVENUE_INVOICE_STATUSES.map((status) => `'${status}'`).join(", "));

/**
 * First-run backfill of ~365 days of history for the backfillable flow metrics (plus the
 * cumulative total_users reconstruction). Guarded by a cheap existence check: if the project
 * already has ANY growth_daily_metrics rows, this is a no-op — the daily rollup's 31-day
 * self-healing window owns corrections from then on.
 *
 * Backfilled metric ids must match the `backfillable: true` entries in metric-catalog.ts.
 * Deliberate omissions (documented in the catalog descriptions): retained/reactivated/returning
 * users (needs the expensive window-function activity split over a year of events), bounce rate /
 * session length (needs per-session grouping), email ok/error splits (status is only meaningful
 * as-of-now), and every snapshot metric except total_users (past state is unknowable — see the
 * historical_state_snapshots catalog entry).
 */
export async function backfillGrowthMetricHistory(tenancy: Tenancy, now: Date): Promise<void> {
  const projectId = tenancy.project.id;
  const branchId = tenancy.branchId;
  const clickhouseClient = getClickhouseAdminClient();

  const existingResult = await clickhouseClient.query({
    query: `
      SELECT count() AS cnt, max(date) AS max_date
      FROM analytics_internal.growth_daily_metrics
      WHERE project_id = {projectId:String}
        AND branch_id = {branchId:String}
    `,
    query_params: { projectId, branchId },
    format: "JSONEachRow",
  });
  const existingRows: { cnt: string | number, max_date: string }[] = await existingResult.json();
  if (Number(existingRows[0]?.cnt ?? 0) > 0) return;

  const { todayUtc, untilExclusive } = getMetricsWindowBounds(now);
  const since = new Date(todayUtc.getTime() - BACKFILL_WINDOW_DAYS * ONE_DAY_MS);
  const allDays: string[] = [];
  for (let t = since.getTime(); t < untilExclusive.getTime(); t += ONE_DAY_MS) {
    allDays.push(toUtcDayKey(new Date(t)));
  }

  const chParams = {
    projectId,
    branchId,
    since: formatClickhouseDateTimeParam(since),
    untilExclusive: formatClickhouseDateTimeParam(untilExclusive),
  };
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);

  const [signupRows, totalUsersRows, eventRows, revenueRows, subscriptionRows, emailRows] = await Promise.all([
    // Signups per day — same predicate as loadTotalUsers with the growth anonymous policy
    // (non-anonymous, non-deleted, bucketed by signed_up_at).
    clickhouseClient.query({
      query: `
        SELECT toDate(signed_up_at) AS day, count() AS cnt
        FROM analytics_internal.users FINAL
        WHERE project_id = {projectId:String}
          AND branch_id = {branchId:String}
          AND sync_is_deleted = 0
          AND is_anonymous = 0
          AND signed_up_at >= {since:DateTime}
          AND signed_up_at < {untilExclusive:DateTime}
        GROUP BY day
        ORDER BY day
      `,
      query_params: chParams,
      format: "JSONEachRow",
    }).then(async (r) => await r.json() as { day: string, cnt: string | number }[]),
    // Current all-time non-anonymous total, the anchor for the cumulative reconstruction.
    clickhouseClient.query({
      query: `
        SELECT countIf(sync_is_deleted = 0 AND is_anonymous = 0) AS total
        FROM analytics_internal.users FINAL
        WHERE project_id = {projectId:String}
          AND branch_id = {branchId:String}
      `,
      query_params: { projectId, branchId },
      format: "JSONEachRow",
    }).then(async (r) => await r.json() as { total: string | number }[]),
    // dau / page_views / clicks / visitors in one events scan. Event-type predicates copied from
    // the live loaders (loadDailyActiveUsers and loadAnalyticsOverview's daily aggregate), with
    // one deliberate simplification: the anonymous check uses only the event's own
    // data.is_anonymous (no token-refresh fallback join) — bounded and simple beats exact for a
    // one-time year-long scan, and the live loader has the same coalesce-to-non-anonymous edge
    // for rows predating is_anonymous capture anyway.
    clickhouseClient.query({
      query: `
        SELECT
          toDate(event_at) AS day,
          uniqExactIf(assumeNotNull(user_id), event_type = '$token-refresh') AS dau,
          countIf(event_type = '$page-view') AS page_views,
          countIf(event_type = '$click') AS clicks,
          uniqExactIf(assumeNotNull(user_id), event_type = '$page-view') AS visitors
        FROM analytics_internal.events
        WHERE event_type IN ('$token-refresh', '$page-view', '$click')
          AND project_id = {projectId:String}
          AND branch_id = {branchId:String}
          AND user_id IS NOT NULL
          AND event_at >= {since:DateTime}
          AND event_at < {untilExclusive:DateTime}
          AND coalesce(CAST(data.is_anonymous, 'Nullable(UInt8)'), 0) = 0
        GROUP BY day
        ORDER BY day
      `,
      query_params: chParams,
      format: "JSONEachRow",
    }).then(async (r) => await r.json() as { day: string, dau: string | number, page_views: string | number, clicks: string | number, visitors: string | number }[]),
    // Revenue per day — query shape copied from loadDailyRevenue, widened to the backfill window.
    prisma.$replica().$queryRaw<{ day: string, new_cents: bigint }[]>`
      SELECT
        TO_CHAR("createdAt"::date, 'YYYY-MM-DD') AS day,
        COALESCE(SUM("amountTotal"), 0)::bigint AS new_cents
      FROM ${sqlQuoteIdent(schema)}."SubscriptionInvoice"
      WHERE "tenancyId" = ${tenancy.id}::UUID
        AND "amountTotal" IS NOT NULL
        AND "status" IN (${REVENUE_STATUSES_SQL})
        AND "createdAt" >= ${since}
        AND "createdAt" < ${untilExclusive}
      GROUP BY day
      ORDER BY day
    `,
    // Subscriptions created per day — query shape copied from loadPaymentsOverview's
    // daily_subscriptions query.
    prisma.$replica().$queryRaw<{ day: string, cnt: number }[]>`
      SELECT
        TO_CHAR("createdAt"::date, 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS cnt
      FROM ${sqlQuoteIdent(schema)}."Subscription"
      WHERE "tenancyId" = ${tenancy.id}::UUID
        AND "createdAt" >= ${since}
        AND "createdAt" < ${untilExclusive}
      GROUP BY day
      ORDER BY day
    `,
    // Outbox emails created per day — query shape copied from loadEmailOverview's per-day query,
    // minus the status split (emails_created is the only backfillable email metric; statuses are
    // only meaningful as-of-now).
    prisma.$replica().$queryRaw<{ day: string, cnt: number }[]>`
      SELECT
        TO_CHAR("createdAt"::date, 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS cnt
      FROM ${sqlQuoteIdent(schema)}."EmailOutbox"
      WHERE "tenancyId" = ${tenancy.id}::UUID
        AND "createdAt" >= ${since}
        AND "createdAt" < ${untilExclusive}
      GROUP BY day
      ORDER BY day
    `,
  ]);

  const rows: GrowthDailyMetricRow[] = [];
  const push = (metricId: string, date: string, value: number) => {
    if (!Number.isFinite(value)) return; // same skip-don't-zero policy as buildGrowthMetricRows
    rows.push({ project_id: projectId, branch_id: branchId, date, metric_id: metricId, value });
  };

  // Postgres- and users-table-derived metrics are zero-filled across the whole window: those
  // sources are complete, so "no row" really does mean 0 that day and the zeros are honest.
  const signupsByDay = new Map(signupRows.map((row) => [row.day.split("T")[0], Number(row.cnt)]));
  const zeroFilledSignups = allDays.map((day) => ({ date: day, activity: signupsByDay.get(day) ?? 0 }));
  for (const point of zeroFilledSignups) push("new_users", point.date, point.activity);

  // total_users reconstruction: current total anchored at today, walking backwards subtracting
  // signups (deleted users make old days slightly approximate — same tradeoff as the legacy
  // total_users daily series, documented in the catalog).
  const currentTotalUsers = Number(totalUsersRows[0]?.total ?? throwErr(new HexclaveAssertionError(
    "ClickHouse returned no row for the total-users aggregate — an aggregation without GROUP BY always yields exactly one row.",
    { projectId, branchId },
  )));
  for (const point of buildCumulativeTotalUsersSeries(zeroFilledSignups, currentTotalUsers)) {
    push("total_users", point.date, point.value);
  }

  const revenueByDay = new Map(revenueRows.map((row) => [row.day, Number(row.new_cents)]));
  const subscriptionsByDay = new Map(subscriptionRows.map((row) => [row.day, Number(row.cnt)]));
  const emailsByDay = new Map(emailRows.map((row) => [row.day, Number(row.cnt)]));
  for (const day of allDays) {
    push("revenue_cents", day, revenueByDay.get(day) ?? 0);
    // Refunds are not tracked yet; the live path stores loadDailyRevenue's constant-0 refund
    // column, so the backfill mirrors that for a continuous series.
    push("refund_cents", day, 0);
    push("new_subscriptions", day, subscriptionsByDay.get(day) ?? 0);
    push("emails_created", day, emailsByDay.get(day) ?? 0);
  }

  // Events-derived metrics are NOT zero-filled: the events stream can have gaps (analytics
  // enabled later, retention) and a fabricated 0 on a day we simply have no data for would poison
  // trends. Only days with at least one matching event get a row.
  for (const row of eventRows) {
    const day = row.day.split("T")[0];
    push("dau", day, Number(row.dau));
    push("page_views", day, Number(row.page_views));
    push("clicks", day, Number(row.clicks));
    push("visitors", day, Number(row.visitors));
  }

  await insertGrowthDailyMetricRows(rows);
}
