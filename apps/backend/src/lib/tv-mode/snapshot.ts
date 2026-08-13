import { getClickhouseAdminClientForMetrics } from "@/lib/clickhouse";
import { type Tenancy } from "@/lib/tenancies";
import {
  evaluateTvEventsIfDue,
  resolveTvEventPresentation,
  type TvEventPresentation,
} from "@/lib/tv-mode/events";
import { resolveTvProfile } from "@/lib/tv-mode/profiles";
import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, sqlQuoteIdent } from "@/prisma-client";
import {
  calculateTvEmailRates,
  calculateTvPaymentSuccessPercent,
  TV_MINIMUM_FINISHED_SENDS,
  TV_MINIMUM_PAYMENT_ATTEMPTS,
  TV_SNAPSHOT_STALE_AFTER_MS,
  type TvAudienceMomentumScreen,
  type TvEmailHealthScreen,
  type TvLivePulseScreen,
  type TvProfileResource,
  type TvReportingWindow,
  type TvRevenuePaymentsScreen,
  type TvScreenSnapshot,
  type TvSnapshot,
  type TvStackedTrendPoint,
  type TvTrendPoint,
} from "@hexclave/shared/dist/interface/admin-tv-mode";
import { captureError, HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";

const DAY_MS = 24 * 60 * 60 * 1000;
const PAID_INVOICE_STATUSES = ["paid", "succeeded"] as const;

// Keep the TV lifecycle query aligned with the memory-bounded metrics overview
// shape. Carrying raw UUIDs through DISTINCT + lagInFrame materializes one row
// per active user/day; this instead keeps one UInt64 day mask per hashed user.
// The unbounded first-activity lookup prevents established users from being
// reclassified as new merely because their first activity predates the window.
export const TV_AUDIENCE_LIFECYCLE_QUERY = `
  SELECT
    toString(addDays(toDate({since:DateTime}), idx)) AS day,
    count() AS total_count,
    countIf(f_first_date = addDays(toDate({since:DateTime}), idx)) AS new_count,
    countIf(f_first_date < addDays(toDate({since:DateTime}), idx) AND idx > 0 AND bitTest(active_days, if(idx = 0, 0, idx - 1))) AS retained_count,
    countIf(f_first_date < addDays(toDate({since:DateTime}), idx) AND (idx = 0 OR NOT bitTest(active_days, if(idx = 0, 0, idx - 1)))) AS reactivated_count
  FROM (
    SELECT activity.active_days AS active_days, first_activity.first_date AS f_first_date
    FROM (
      SELECT
        sipHash64(assumeNotNull(user_id)) AS entity_id,
        groupBitOr(bitShiftLeft(toUInt64(1), toUInt8(dateDiff('day', toDate({since:DateTime}), toDate(event_at))))) AS active_days
      FROM analytics_internal.events
      WHERE event_type = '$token-refresh'
        AND project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND user_id IS NOT NULL
        AND event_at >= {since:DateTime}
        AND event_at < {until:DateTime}
        AND coalesce(CAST(data.is_anonymous, 'Nullable(UInt8)'), 0) = 0
      GROUP BY entity_id
    ) AS activity
    LEFT JOIN (
      SELECT
        sipHash64(assumeNotNull(user_id)) AS entity_id,
        toDate(min(event_at)) AS first_date
      FROM analytics_internal.events
      WHERE event_type = '$token-refresh'
        AND project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND user_id IS NOT NULL
        AND event_at < {until:DateTime}
        AND coalesce(CAST(data.is_anonymous, 'Nullable(UInt8)'), 0) = 0
      GROUP BY entity_id
    ) AS first_activity USING (entity_id)
  )
  ARRAY JOIN range({windowDays:UInt32}) AS idx
  WHERE bitTest(active_days, idx)
  GROUP BY idx
  ORDER BY idx
`;

class TvSnapshotInvariantError extends Error {
  override name = "TvSnapshotInvariantError";
}

type TvWindowBounds = {
  currentStartsAt: Date,
  currentEndsAt: Date,
  comparisonStartsAt: Date,
  comparisonEndsAt: Date,
};

type TvAdapterResult<TScreen extends TvScreenSnapshot> =
  | { status: "success", screen: TScreen }
  | { status: "error", screen: TScreen };

export function getTvOperationalMetricsClient<T>(prisma: { $replica: () => T }): T {
  return prisma.$replica();
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

function percentChange(current: number, comparison: number): number {
  return comparison > 0 ? roundPercent(((current - comparison) / comparison) * 100) : 0;
}

export function isTvReturningInsightEligible(newActivity: number, returningActivity: number): boolean {
  if (newActivity <= 0 || returningActivity <= newActivity) return false;
  return roundPercent(((returningActivity - newActivity) / newActivity) * 100) >= 10;
}

export function isTvEmailInsightEligible(
  deliveryRatePercent: number | null,
  volumeChangePercent: number,
): deliveryRatePercent is number {
  return deliveryRatePercent != null && deliveryRatePercent >= 99 && volumeChangePercent > 20;
}

function getRollingWindow(now: Date, days: number): TvWindowBounds {
  const currentEndsAt = new Date(now);
  const currentStartsAt = new Date(currentEndsAt.getTime() - days * DAY_MS);
  return {
    currentStartsAt,
    currentEndsAt,
    comparisonStartsAt: new Date(currentStartsAt.getTime() - days * DAY_MS),
    comparisonEndsAt: currentStartsAt,
  };
}

function reportingWindow(bounds: TvWindowBounds, days: number): TvReportingWindow {
  return {
    current: {
      startsAt: bounds.currentStartsAt.toISOString(),
      endsAt: bounds.currentEndsAt.toISOString(),
      label: `Trailing ${days} days`,
    },
    comparison: {
      startsAt: bounds.comparisonStartsAt.toISOString(),
      endsAt: bounds.comparisonEndsAt.toISOString(),
      label: `Previous ${days} days`,
    },
  };
}

function currentDayWindow(now: Date): TvReportingWindow {
  const startsAt = new Date(now);
  startsAt.setUTCHours(0, 0, 0, 0);
  return {
    current: {
      startsAt: startsAt.toISOString(),
      endsAt: now.toISOString(),
      label: "Today · UTC",
    },
    comparison: null,
  };
}

function formatClickhouseDateTime(date: Date): string {
  return date.toISOString().slice(0, 19);
}

function dayLabel(dateString: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${dateString}T00:00:00.000Z`));
}

function dateKeys(bounds: TvWindowBounds, count: number): string[] {
  const firstDay = new Date(bounds.currentEndsAt);
  firstDay.setUTCHours(0, 0, 0, 0);
  firstDay.setUTCDate(firstDay.getUTCDate() - (count - 1));
  return Array.from({ length: count }, (_, index) => (
    new Date(firstDay.getTime() + index * DAY_MS).toISOString().slice(0, 10)
  ));
}

function normalizeTrend(points: TvTrendPoint[]): TvTrendPoint[] {
  const values = points.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (maximum === minimum) return points.map((point) => ({ label: point.label, value: 100 }));
  return points.map((point) => ({
    label: point.label,
    value: Math.round(80 + ((point.value - minimum) / (maximum - minimum)) * 40),
  }));
}

function buildCumulativeRevenueTrend(bounds: TvWindowBounds, revenueByDay: Map<string, number>): TvTrendPoint[] {
  const firstDay = new Date(bounds.currentStartsAt);
  firstDay.setUTCHours(0, 0, 0, 0);
  const daily = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(firstDay.getTime() + index * DAY_MS);
    const key = date.toISOString().slice(0, 10);
    return { date, value: revenueByDay.get(key) ?? 0 };
  });
  let cumulative = 0;
  const cumulativeDaily = daily.map((point) => {
    cumulative += point.value;
    return { ...point, value: cumulative };
  });
  return [0, 5, 10, 15, 20, 25, 29].map((index) => {
    const point = cumulativeDaily.at(index);
    if (point == null) throw new TvSnapshotInvariantError("TV revenue trend sample index is outside its 30-day series.");
    return {
      label: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(point.date),
      value: point.value,
    };
  });
}

function errorScreen<TScreen extends TvScreenSnapshot>(
  screen: TScreen,
  adapterName: string,
  cause: unknown,
  tenancy: Tenancy,
): TvAdapterResult<TScreen> {
  captureError(`tv-snapshot-${adapterName}-failed`, new HexclaveAssertionError(
    `TV snapshot ${adapterName} adapter failed.`,
    {
      cause,
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
    },
  ));
  return {
    status: "error",
    screen: {
      ...screen,
      sourceStatus: "error",
      diagnosticCode: "source-query-failed",
      data: null,
      insight: null,
    },
  };
}

export function createTvLivePulseErrorScreen(now: Date): TvLivePulseScreen {
  return {
    id: "live-pulse",
    sourceStatus: "error",
    sourceLabel: "Hexclave activity",
    observedAt: now.toISOString(),
    window: currentDayWindow(now),
    diagnosticCode: "source-query-failed",
    data: null,
    insight: null,
  };
}

export function createReadyTvLivePulseScreen(options: {
  now: Date,
  liveUsers: number,
  todayActiveUsers: number,
  hourlyActivity: TvTrendPoint[],
}): TvLivePulseScreen {
  const currentHour = new Date(options.now);
  currentHour.setUTCMinutes(0, 0, 0);
  return {
    id: "live-pulse",
    sourceStatus: "ready",
    sourceLabel: "Hexclave activity",
    observedAt: options.now.toISOString(),
    window: currentDayWindow(options.now),
    diagnosticCode: null,
    data: {
      liveUsers: options.liveUsers,
      todayActiveUsers: options.todayActiveUsers,
      hourlyActivity: options.hourlyActivity.length > 0 ? options.hourlyActivity : [{
        label: currentHour.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "UTC",
        }),
        value: 0,
      }],
      sourceHealth: [],
    },
    insight: null,
  };
}

async function loadActivityScreens(
  tenancy: Tenancy,
  now: Date,
): Promise<{ livePulse: TvAdapterResult<TvLivePulseScreen>, audience: TvAdapterResult<TvAudienceMomentumScreen> }> {
  const observedAt = now.toISOString();
  const sevenDayBounds = getRollingWindow(now, 7);
  const emptyLive = createTvLivePulseErrorScreen(now);
  const emptyAudience: TvAudienceMomentumScreen = {
    id: "audience-momentum",
    sourceStatus: "error",
    sourceLabel: "Hexclave users & analytics",
    observedAt,
    window: reportingWindow(sevenDayBounds, 7),
    diagnosticCode: "source-query-failed",
    data: null,
    insight: null,
  };

  try {
    const todayStartsAt = new Date(now);
    todayStartsAt.setUTCHours(0, 0, 0, 0);
    const monthlyStartsAt = new Date(now.getTime() - 30 * DAY_MS);
    const clickhouse = getClickhouseAdminClientForMetrics();
    const [liveResult, hourlyResult, usersResult, lifecycleResult, mauResult] = await Promise.all([
      clickhouse.query({
        query: `
          SELECT uniqExact(assumeNotNull(user_id)) AS live_users
          FROM analytics_internal.events
          WHERE event_type = '$token-refresh'
            AND project_id = {projectId:String}
            AND branch_id = {branchId:String}
            AND user_id IS NOT NULL
            AND event_at >= {since:DateTime}
            AND event_at < {until:DateTime}
            AND coalesce(CAST(data.is_anonymous, 'Nullable(UInt8)'), 0) = 0
        `,
        query_params: {
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
          since: formatClickhouseDateTime(new Date(now.getTime() - 2 * 60 * 1000)),
          until: formatClickhouseDateTime(now),
        },
        format: "JSONEachRow",
      }),
      clickhouse.query({
        query: `
          SELECT toStartOfHour(event_at) AS hour,
            uniqExact(assumeNotNull(user_id)) AS active_users
          FROM analytics_internal.events
          WHERE event_type = '$token-refresh'
            AND project_id = {projectId:String}
            AND branch_id = {branchId:String}
            AND user_id IS NOT NULL
            AND event_at >= {since:DateTime}
            AND event_at < {until:DateTime}
            AND coalesce(CAST(data.is_anonymous, 'Nullable(UInt8)'), 0) = 0
          GROUP BY hour
          ORDER BY hour
        `,
        query_params: {
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
          since: formatClickhouseDateTime(todayStartsAt),
          until: formatClickhouseDateTime(now),
        },
        format: "JSONEachRow",
      }),
      clickhouse.query({
        query: `
          SELECT
            countIf(sync_is_deleted = 0 AND is_anonymous = 0) AS total_users,
            countIf(
              sync_is_deleted = 0
              AND is_anonymous = 0
              AND signed_up_at >= {currentSince:DateTime}
              AND signed_up_at < {currentUntil:DateTime}
            ) AS current_new_users,
            (
              SELECT uniqExact(id)
              FROM analytics_internal.users
              WHERE project_id = {projectId:String}
                AND branch_id = {branchId:String}
                AND sync_is_deleted = 1
                AND is_anonymous = 0
                AND signed_up_at < {currentSince:DateTime}
                AND sync_created_at >= {currentSince:DateTime}
                AND sync_created_at < {currentUntil:DateTime}
            ) AS deleted_existing_users,
            countIf(
              sync_is_deleted = 0
              AND is_anonymous = 0
              AND id IN (
                SELECT user_id
                FROM analytics_internal.contact_channels FINAL
                WHERE project_id = {projectId:String}
                  AND branch_id = {branchId:String}
                  AND sync_is_deleted = 0
                  AND type = 'EMAIL'
                  AND is_verified = 1
              )
            ) AS verified_users
          FROM analytics_internal.users FINAL
          WHERE project_id = {projectId:String}
            AND branch_id = {branchId:String}
        `,
        query_params: {
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
          currentSince: formatClickhouseDateTime(sevenDayBounds.currentStartsAt),
          currentUntil: formatClickhouseDateTime(sevenDayBounds.currentEndsAt),
        },
        format: "JSONEachRow",
      }),
      clickhouse.query({
        query: TV_AUDIENCE_LIFECYCLE_QUERY,
        query_params: {
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
          since: formatClickhouseDateTime(sevenDayBounds.currentStartsAt),
          until: formatClickhouseDateTime(sevenDayBounds.currentEndsAt),
          windowDays: 7,
        },
        format: "JSONEachRow",
      }),
      clickhouse.query({
        query: `
          SELECT uniqExact(assumeNotNull(user_id)) AS mau
          FROM analytics_internal.events
          WHERE event_type = '$token-refresh'
            AND project_id = {projectId:String}
            AND branch_id = {branchId:String}
            AND user_id IS NOT NULL
            AND event_at >= {since:DateTime}
            AND event_at < {until:DateTime}
            AND coalesce(CAST(data.is_anonymous, 'Nullable(UInt8)'), 0) = 0
        `,
        query_params: {
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
          since: formatClickhouseDateTime(monthlyStartsAt),
          until: formatClickhouseDateTime(now),
        },
        format: "JSONEachRow",
      }),
    ]);
    const [
      liveRows,
      hourlyRows,
      usersRows,
      lifecycleRows,
      mauRows,
    ] = await Promise.all([
      liveResult.json<{ live_users: number | string }>(),
      hourlyResult.json<{ hour: string, active_users: number | string }>(),
      usersResult.json<{
        total_users: number | string,
        current_new_users: number | string,
        deleted_existing_users: number | string,
        verified_users: number | string,
      }>(),
      lifecycleResult.json<{
        day: string,
        total_count: number | string,
        new_count: number | string,
        retained_count: number | string,
        reactivated_count: number | string,
      }>(),
      mauResult.json<{ mau: number | string }>(),
    ]);
    const liveRow = liveRows.at(0);
    const mauRow = mauRows.at(0);
    if (liveRow == null || mauRow == null) {
      throw new TvSnapshotInvariantError("TV activity aggregate returned no summary row.");
    }
    const liveUsers = Number(liveRow.live_users);
    const todayKey = now.toISOString().slice(0, 10);
    const lifecycleByDate = new Map(lifecycleRows.map((row) => [row.day.slice(0, 10), {
      total: Number(row.total_count),
      primary: Number(row.new_count),
      secondary: Number(row.retained_count),
      tertiary: Number(row.reactivated_count),
    }]));
    const todayActivity = lifecycleByDate.get(todayKey)?.total ?? 0;
    const todayHourly = hourlyRows.map((point) => ({
      label: new Date(point.hour).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }),
      value: Number(point.active_users),
    }));

    const lifecycle = dateKeys(sevenDayBounds, 7).map((date): TvStackedTrendPoint => ({
      label: dayLabel(date),
      primary: lifecycleByDate.get(date)?.primary ?? 0,
      secondary: lifecycleByDate.get(date)?.secondary ?? 0,
      tertiary: lifecycleByDate.get(date)?.tertiary ?? 0,
    }));
    const users = usersRows.at(0);
    if (users == null) throw new TvSnapshotInvariantError("TV users aggregate returned no summary row.");
    const totalUsers = Number(users.total_users);
    const currentNewUsers = Number(users.current_new_users);
    const previousTotalUsers = totalUsers - currentNewUsers + Number(users.deleted_existing_users);
    const currentReturning = lifecycle.reduce((sum, point) => sum + point.secondary + point.tertiary, 0);
    const returningLeadMarginPercent = currentNewUsers > 0
      ? roundPercent(((currentReturning - currentNewUsers) / currentNewUsers) * 100)
      : 0;
    const verificationRatePercent = totalUsers > 0
      ? roundPercent((Number(users.verified_users) / totalUsers) * 100)
      : 0;

    // A successful zero is an observed operational value, not an empty source.
    // Live Pulse has no minimum sample, so its content remains useful even when
    // no signed-in users refreshed during either activity window.
    const livePulse = createReadyTvLivePulseScreen({
      now,
      liveUsers,
      todayActiveUsers: todayActivity,
      hourlyActivity: todayHourly,
    });
    const hasAudience = totalUsers > 0;
    const audience: TvAudienceMomentumScreen = {
      ...emptyAudience,
      sourceStatus: hasAudience ? "ready" : "empty",
      diagnosticCode: null,
      data: hasAudience ? {
        totalUsers,
        userGrowthPercent: percentChange(totalUsers, Math.max(0, previousTotalUsers)),
        newUsers: currentNewUsers,
        monthlyActiveUsers: Number(mauRow.mau),
        visitors: 0,
        averageSessionSeconds: 0,
        verificationRatePercent,
        lifecycle,
      } : null,
      insight: hasAudience && isTvReturningInsightEligible(currentNewUsers, currentReturning) ? {
        kind: "returning-users-leading",
        message: "Audience momentum is being driven primarily by returning users.",
        evidence: {
          newActivity: currentNewUsers,
          retainedActivity: lifecycle.reduce((sum, point) => sum + point.secondary, 0),
          reactivatedActivity: lifecycle.reduce((sum, point) => sum + point.tertiary, 0),
          leadMarginPercent: returningLeadMarginPercent,
        },
      } : null,
    };
    return {
      livePulse: { status: "success", screen: livePulse },
      audience: { status: "success", screen: audience },
    };
  } catch (cause) {
    if (cause instanceof TvSnapshotInvariantError) throw cause;
    return {
      livePulse: errorScreen(emptyLive, "users-activity", cause, tenancy),
      audience: errorScreen(emptyAudience, "users-activity", cause, tenancy),
    };
  }
}

async function loadAnalyticsIntoAudience(
  tenancy: Tenancy,
  now: Date,
  audienceResult: TvAdapterResult<TvAudienceMomentumScreen>,
): Promise<TvAdapterResult<TvAudienceMomentumScreen>> {
  if (audienceResult.screen.data == null) return audienceResult;
  if (!(tenancy.config.apps.installed.analytics?.enabled ?? false)) {
    return {
      status: "success",
      screen: {
        ...audienceResult.screen,
        sourceStatus: "unavailable",
        diagnosticCode: "analytics-app-disabled",
        data: null,
        insight: null,
      },
    };
  }
  const bounds = getRollingWindow(now, 7);
  try {
    const result = await getClickhouseAdminClientForMetrics().query({
      query: `
        WITH sessions AS (
          SELECT
            session_replay_segment_id AS sid,
            dateDiff('second', min(event_at), max(event_at)) AS duration_s
          FROM analytics_internal.events
          WHERE project_id = {projectId:String}
            AND branch_id = {branchId:String}
            AND event_at >= {since:DateTime}
            AND event_at < {until:DateTime}
            AND event_type IN ('$page-view', '$click')
            AND user_id IS NOT NULL
            AND session_replay_segment_id IS NOT NULL
            AND coalesce(CAST(data.is_anonymous, 'Nullable(UInt8)'), 0) = 0
          GROUP BY sid
        )
        SELECT
          (
            SELECT uniqExact(assumeNotNull(user_id))
            FROM analytics_internal.events
            WHERE project_id = {projectId:String}
              AND branch_id = {branchId:String}
              AND event_at >= {since:DateTime}
              AND event_at < {until:DateTime}
              AND event_type = '$page-view'
              AND user_id IS NOT NULL
              AND coalesce(CAST(data.is_anonymous, 'Nullable(UInt8)'), 0) = 0
          ) AS visitors,
          (SELECT ifNull(avg(duration_s), 0) FROM sessions) AS average_session_seconds
      `,
      query_params: {
        projectId: tenancy.project.id,
        branchId: tenancy.branchId,
        since: formatClickhouseDateTime(bounds.currentStartsAt),
        until: formatClickhouseDateTime(bounds.currentEndsAt),
      },
      format: "JSONEachRow",
    });
    const rows = await result.json<{ visitors: number | string, average_session_seconds: number | string }>();
    const row = rows.at(0);
    if (row == null) throw new TvSnapshotInvariantError("TV analytics aggregate returned no summary row.");
    return {
      status: "success",
      screen: {
        ...audienceResult.screen,
        data: {
          ...audienceResult.screen.data,
          visitors: Number(row.visitors),
          averageSessionSeconds: Math.round(Number(row.average_session_seconds)),
        },
      },
    };
  } catch (cause) {
    if (cause instanceof TvSnapshotInvariantError) throw cause;
    return errorScreen(audienceResult.screen, "analytics", cause, tenancy);
  }
}

async function loadRevenueScreen(
  tenancy: Tenancy,
  now: Date,
  financialVisibility: "redacted" | "exact",
): Promise<TvAdapterResult<TvRevenuePaymentsScreen>> {
  const observedAt = now.toISOString();
  const bounds = getRollingWindow(now, 30);
  const emptyScreen: TvRevenuePaymentsScreen = {
    id: "revenue-payments",
    sourceStatus: "error",
    sourceLabel: "Hexclave payments",
    observedAt,
    window: reportingWindow(bounds, 30),
    diagnosticCode: "source-query-failed",
    data: null,
    insight: null,
  };
  if (!(tenancy.config.apps.installed.payments?.enabled ?? false)) {
    return {
      status: "success",
      screen: { ...emptyScreen, sourceStatus: "unavailable", diagnosticCode: "payments-app-disabled" },
    };
  }

  try {
    const schema = await getPrismaSchemaForTenancy(tenancy);
    const prisma = await getPrismaClientForTenancy(tenancy);
    const metricsPrisma = getTvOperationalMetricsClient(prisma);
    const successfulStatuses = PAID_INVOICE_STATUSES;
    const [summaryRows, trendRows] = await Promise.all([
      metricsPrisma.$queryRaw<[{
        current_revenue: bigint,
        previous_revenue: bigint,
        applicable_attempts: number,
        successful_attempts: number,
        active_subscriptions: number,
        new_subscriptions: number,
        past_due_subscriptions: number,
      }]>`
        SELECT
          COALESCE(SUM("amountTotal") FILTER (
            WHERE "createdAt" >= ${bounds.currentStartsAt}
              AND "status" IN (${successfulStatuses[0]}, ${successfulStatuses[1]})
          ), 0)::bigint AS current_revenue,
          COALESCE(SUM("amountTotal") FILTER (
            WHERE "createdAt" >= ${bounds.comparisonStartsAt}
              AND "createdAt" < ${bounds.comparisonEndsAt}
              AND "status" IN (${successfulStatuses[0]}, ${successfulStatuses[1]})
          ), 0)::bigint AS previous_revenue,
          COUNT(*) FILTER (
            WHERE "createdAt" >= ${bounds.currentStartsAt}
              AND COALESCE("amountTotal", 0) > 0
          )::int AS applicable_attempts,
          COUNT(*) FILTER (
            WHERE "createdAt" >= ${bounds.currentStartsAt}
              AND COALESCE("amountTotal", 0) > 0
              AND "status" IN (${successfulStatuses[0]}, ${successfulStatuses[1]})
          )::int AS successful_attempts,
          (SELECT COUNT(*)::int FROM ${sqlQuoteIdent(schema)}."Subscription"
            WHERE "tenancyId" = ${tenancy.id}::UUID AND "status" = 'active'::"SubscriptionStatus") AS active_subscriptions,
          (SELECT COUNT(*)::int FROM ${sqlQuoteIdent(schema)}."Subscription"
            WHERE "tenancyId" = ${tenancy.id}::UUID AND "createdAt" >= ${bounds.currentStartsAt}) AS new_subscriptions,
          (SELECT COUNT(*)::int FROM ${sqlQuoteIdent(schema)}."Subscription"
            WHERE "tenancyId" = ${tenancy.id}::UUID AND "status" = 'past_due'::"SubscriptionStatus") AS past_due_subscriptions
        FROM ${sqlQuoteIdent(schema)}."SubscriptionInvoice"
        WHERE "tenancyId" = ${tenancy.id}::UUID
          AND "createdAt" >= ${bounds.comparisonStartsAt}
          AND "createdAt" < ${bounds.currentEndsAt}
      `,
      metricsPrisma.$queryRaw<{ day: string, revenue: bigint }[]>`
        SELECT TO_CHAR("createdAt"::date, 'YYYY-MM-DD') AS day,
          COALESCE(SUM("amountTotal"), 0)::bigint AS revenue
        FROM ${sqlQuoteIdent(schema)}."SubscriptionInvoice"
        WHERE "tenancyId" = ${tenancy.id}::UUID
          AND "createdAt" >= ${bounds.currentStartsAt}
          AND "createdAt" < ${bounds.currentEndsAt}
          AND "status" IN (${successfulStatuses[0]}, ${successfulStatuses[1]})
        GROUP BY day
        ORDER BY day
      `,
    ]);
    const summary = summaryRows[0];
    const currentRevenue = Number(summary.current_revenue);
    const previousRevenue = Number(summary.previous_revenue);
    const attempts = Number(summary.applicable_attempts);
    const successes = Number(summary.successful_attempts);
    const paymentSuccessPercent = calculateTvPaymentSuccessPercent(attempts, successes);
    const revenueByDay = new Map(trendRows.map((row) => [row.day, Number(row.revenue)]));
    const revenueTrend = buildCumulativeRevenueTrend(bounds, revenueByDay);
    const revenueChangePercent = percentChange(currentRevenue, previousRevenue);
    const hasPaymentData = hasTvPaymentData({
      applicableAttempts: attempts,
      currentRevenue,
      activeSubscriptions: Number(summary.active_subscriptions),
      newSubscriptions: Number(summary.new_subscriptions),
      pastDueSubscriptions: Number(summary.past_due_subscriptions),
    });
    const screen: TvRevenuePaymentsScreen = {
      ...emptyScreen,
      sourceStatus: !hasPaymentData ? "empty" : attempts < TV_MINIMUM_PAYMENT_ATTEMPTS ? "insufficient-data" : "ready",
      diagnosticCode: null,
      data: hasPaymentData ? {
        financials: financialVisibility === "exact" ? {
          visibility: "exact",
          paidRevenueCents: currentRevenue,
          mrrProxyCents: currentRevenue,
          revenueTrend,
        } : {
          visibility: "redacted",
          direction: revenueChangePercent > 0 ? "up" : revenueChangePercent < 0 ? "down" : "flat",
          normalizedRevenueTrend: normalizeTrend(revenueTrend),
        },
        revenueChangePercent,
        activeSubscriptions: Number(summary.active_subscriptions),
        newSubscriptions: Number(summary.new_subscriptions),
        pastDueSubscriptions: Number(summary.past_due_subscriptions),
        paymentSuccess: { applicableAttempts: attempts, percent: paymentSuccessPercent },
      } : null,
      insight: hasPaymentData && paymentSuccessPercent != null && revenueChangePercent > 0 && paymentSuccessPercent >= 95 ? {
        kind: "revenue-up-payments-stable",
        message: "Gross paid invoice revenue increased while payment collection remained stable.",
        evidence: {
          revenueChangePercent,
          paymentSuccessPercent,
          applicablePaymentAttempts: attempts,
        },
      } : null,
    };
    return { status: "success", screen };
  } catch (cause) {
    if (cause instanceof TvSnapshotInvariantError) throw cause;
    return errorScreen(emptyScreen, "payments", cause, tenancy);
  }
}

async function loadEmailScreen(tenancy: Tenancy, now: Date): Promise<TvAdapterResult<TvEmailHealthScreen>> {
  const observedAt = now.toISOString();
  const bounds = getRollingWindow(now, 7);
  const emptyScreen: TvEmailHealthScreen = {
    id: "email-health",
    sourceStatus: "error",
    sourceLabel: "Hexclave email",
    observedAt,
    window: reportingWindow(bounds, 7),
    diagnosticCode: "source-query-failed",
    data: null,
    insight: null,
  };
  if (!(tenancy.config.apps.installed.emails?.enabled ?? false)) {
    return {
      status: "success",
      screen: { ...emptyScreen, sourceStatus: "unavailable", diagnosticCode: "emails-app-disabled" },
    };
  }

  try {
    const schema = await getPrismaSchemaForTenancy(tenancy);
    const prisma = await getPrismaClientForTenancy(tenancy);
    const metricsPrisma = getTvOperationalMetricsClient(prisma);
    const [summaryRows, trendRows] = await Promise.all([
      metricsPrisma.$queryRaw<[{
        current_finished: number,
        previous_finished: number,
        delivered: number,
        bounced: number,
        errors: number,
        in_progress: number,
      }]>`
        SELECT
          COUNT(*) FILTER (
            WHERE "createdAt" >= ${bounds.currentStartsAt}
              AND "finishedSendingAt" IS NOT NULL
          )::int AS current_finished,
          COUNT(*) FILTER (
            WHERE "createdAt" >= ${bounds.comparisonStartsAt}
              AND "createdAt" < ${bounds.comparisonEndsAt}
              AND "finishedSendingAt" IS NOT NULL
          )::int AS previous_finished,
          COUNT(*) FILTER (
            WHERE "createdAt" >= ${bounds.currentStartsAt}
              AND "deliveredAt" IS NOT NULL
          )::int AS delivered,
          COUNT(*) FILTER (
            WHERE "createdAt" >= ${bounds.currentStartsAt}
              AND "bouncedAt" IS NOT NULL
          )::int AS bounced,
          COUNT(*) FILTER (
            WHERE "createdAt" >= ${bounds.currentStartsAt}
              AND "simpleStatus" = 'ERROR'::"EmailOutboxSimpleStatus"
          )::int AS errors,
          COUNT(*) FILTER (
            WHERE "simpleStatus" = 'IN_PROGRESS'::"EmailOutboxSimpleStatus"
          )::int AS in_progress
        FROM ${sqlQuoteIdent(schema)}."EmailOutbox"
        WHERE "tenancyId" = ${tenancy.id}::UUID
          AND (
            "createdAt" >= ${bounds.comparisonStartsAt}
            OR "simpleStatus" = 'IN_PROGRESS'::"EmailOutboxSimpleStatus"
          )
      `,
      metricsPrisma.$queryRaw<{ day: string, delivered: number, error: number, in_progress: number }[]>`
        SELECT
          TO_CHAR("createdAt"::date, 'YYYY-MM-DD') AS day,
          COUNT(*) FILTER (WHERE "deliveredAt" IS NOT NULL)::int AS delivered,
          COUNT(*) FILTER (WHERE "simpleStatus" = 'ERROR'::"EmailOutboxSimpleStatus")::int AS error,
          COUNT(*) FILTER (WHERE "simpleStatus" = 'IN_PROGRESS'::"EmailOutboxSimpleStatus")::int AS in_progress
        FROM ${sqlQuoteIdent(schema)}."EmailOutbox"
        WHERE "tenancyId" = ${tenancy.id}::UUID
          AND "createdAt" >= ${bounds.currentStartsAt}
          AND "createdAt" < ${bounds.currentEndsAt}
        GROUP BY day
        ORDER BY day
      `,
    ]);
    const summary = summaryRows[0];
    const sent = Number(summary.current_finished);
    const delivered = Number(summary.delivered);
    const bounced = Number(summary.bounced);
    const previousSent = Number(summary.previous_finished);
    const qualifies = sent >= TV_MINIMUM_FINISHED_SENDS;
    const { deliveryRatePercent, bounceRatePercent } = calculateTvEmailRates(sent, delivered, bounced);
    const volumeChangePercent = percentChange(sent, previousSent);
    const trendByDay = new Map(trendRows.map((row) => [row.day, row]));
    const statusTrend = dateKeys(bounds, 7).map((date): TvStackedTrendPoint => {
      const row = trendByDay.get(date);
      return {
        label: dayLabel(date),
        primary: Number(row?.delivered ?? 0),
        secondary: Number(row?.error ?? 0),
        tertiary: Number(row?.in_progress ?? 0),
      };
    });
    const hasEmailData = sent > 0 || Number(summary.in_progress) > 0;
    const screen: TvEmailHealthScreen = {
      ...emptyScreen,
      sourceStatus: !hasEmailData ? "empty" : qualifies ? "ready" : "insufficient-data",
      diagnosticCode: null,
      data: hasEmailData ? {
        sent,
        delivered,
        bounced,
        errors: Number(summary.errors),
        inProgress: Number(summary.in_progress),
        deliveryRatePercent,
        bounceRatePercent,
        volumeChangePercent,
        statusTrend,
      } : null,
      insight: hasEmailData && isTvEmailInsightEligible(deliveryRatePercent, volumeChangePercent) ? {
        kind: "delivery-healthy-volume-up",
        message: `Delivery remained above 99% while sending volume increased by ${Math.round(volumeChangePercent)}%.`,
        evidence: { deliveryRatePercent, volumeChangePercent, finishedSends: sent },
      } : null,
    };
    return { status: "success", screen };
  } catch (cause) {
    if (cause instanceof TvSnapshotInvariantError) throw cause;
    return errorScreen(emptyScreen, "email", cause, tenancy);
  }
}

export function hasTvPaymentData(metrics: {
  applicableAttempts: number,
  currentRevenue: number,
  activeSubscriptions: number,
  newSubscriptions: number,
  pastDueSubscriptions: number,
}): boolean {
  return metrics.applicableAttempts > 0
    || metrics.currentRevenue !== 0
    || metrics.activeSubscriptions > 0
    || metrics.newSubscriptions > 0
    || metrics.pastDueSubscriptions > 0;
}

export function sourceHealthFact(
  label: string,
  screen: TvRevenuePaymentsScreen | TvEmailHealthScreen | TvAudienceMomentumScreen,
): { label: string, status: "healthy" | "ready" | "empty" | "insufficient-data" | "unavailable" | "error" | "stale", value: string, detail: string } {
  if (screen.sourceStatus === "ready") {
    if (screen.id === "email-health") {
      return {
        label,
        status: "ready",
        value: screen.data?.deliveryRatePercent == null ? "Ready" : `${screen.data.deliveryRatePercent}%`,
        detail: "Metrics available",
      };
    }
    if (screen.id === "revenue-payments") {
      return {
        label,
        status: "ready",
        value: screen.data?.paymentSuccess.percent == null ? "Ready" : `${screen.data.paymentSuccess.percent}%`,
        detail: "Metrics available",
      };
    }
    return { label, status: "ready", value: "Fresh", detail: "Metrics available" };
  }
  if (screen.sourceStatus === "empty") {
    return { label, status: "empty", value: "No activity", detail: "No data in this reporting window" };
  }
  if (screen.sourceStatus === "insufficient-data") {
    return { label, status: "insufficient-data", value: "Limited", detail: "Insufficient data" };
  }
  if (screen.sourceStatus === "error") {
    return { label, status: "error", value: "Error", detail: "Source error" };
  }
  if (screen.sourceStatus === "stale") {
    return { label, status: "stale", value: "Stale", detail: "Data may be outdated" };
  }
  return { label, status: "unavailable", value: "Unavailable", detail: "Source unavailable" };
}

export function addTvSourceHealth(
  livePulse: TvLivePulseScreen,
  sources: {
    email: TvEmailHealthScreen,
    revenue: TvRevenuePaymentsScreen,
    audience: TvAudienceMomentumScreen,
  },
): TvLivePulseScreen {
  if (livePulse.data == null) return livePulse;
  return {
    ...livePulse,
    data: {
      ...livePulse.data,
      sourceHealth: [
        sourceHealthFact("Email delivery", sources.email),
        sourceHealthFact("Payment collection", sources.revenue),
        sourceHealthFact("Analytics", sources.audience),
      ],
    },
  };
}

export function assembleTvSnapshot(options: {
  project: { id: string, displayName: string },
  profile: TvProfileResource,
  now: Date,
  includeScreenDurations?: boolean,
  screens: {
    livePulse: TvLivePulseScreen,
    audience: TvAudienceMomentumScreen,
    revenue: TvRevenuePaymentsScreen,
    email: TvEmailHealthScreen,
  },
  presentation?: TvEventPresentation,
}): TvSnapshot {
  const configuration = options.profile.configuration;
  const exactFinancialsAllowed = configuration.financialVisibility === "exact";
  if (options.screens.revenue.data?.financials.visibility === "exact" && !exactFinancialsAllowed) {
    throw new HexclaveAssertionError("Live TV snapshots must not expose exact financial values for a redacted profile.");
  }
  const playlist = configuration.playlist.map((entry) => entry.screenId);
  return {
    generatedAt: options.now.toISOString(),
    staleAfter: new Date(options.now.getTime() + TV_SNAPSHOT_STALE_AFTER_MS).toISOString(),
    connectionStatus: "online",
    project: {
      id: options.project.id,
      displayName: options.project.displayName,
    },
    profile: {
      id: options.profile.id,
      displayName: configuration.displayName,
      mode: "general",
      defaultDurationSeconds: configuration.defaultDurationSeconds,
      playlist,
      ...(options.includeScreenDurations ? {
        screenDurations: configuration.playlist.map((entry) => ({
          screenId: entry.screenId,
          durationSeconds: entry.durationSecondsOverride ?? configuration.defaultDurationSeconds,
        })),
      } : {}),
    },
    screens: [
      options.screens.livePulse,
      options.screens.audience,
      options.screens.revenue,
      options.screens.email,
    ],
    presentation: options.presentation ?? { highlight: null, takeover: null },
    fatalErrorMessage: null,
  };
}

export async function buildLiveTvSnapshot(options: {
  tenancy: Tenancy,
  profileId: string,
  now?: Date,
  includeScreenDurations?: boolean,
}): Promise<TvSnapshot | null> {
  const now = options.now ?? new Date();
  const profile = await resolveTvProfile(options.tenancy, options.profileId);
  if (profile == null) return null;

  const [activity, revenue, email] = await Promise.all([
    loadActivityScreens(options.tenancy, now),
    loadRevenueScreen(options.tenancy, now, profile.configuration.financialVisibility),
    loadEmailScreen(options.tenancy, now),
  ]);
  const audience = await loadAnalyticsIntoAudience(options.tenancy, now, activity.audience);
  const livePulse = addTvSourceHealth(activity.livePulse.screen, {
    email: email.screen,
    revenue: revenue.screen,
    audience: audience.screen,
  });
  await evaluateTvEventsIfDue({
    tenancy: options.tenancy,
    now,
    totalUsers: audience.screen.data?.totalUsers ?? null,
  });
  let presentation: TvEventPresentation = { highlight: null, takeover: null };
  try {
    presentation = await resolveTvEventPresentation({
      tenancy: options.tenancy,
      profile,
      now,
    });
  } catch (cause) {
    captureError("tv-event-presentation-resolution-failed", new HexclaveAssertionError(
      "TV event presentation resolution failed without affecting the operational snapshot.",
      { cause, tenancyId: options.tenancy.id, profileId: profile.id },
    ));
  }

  return assembleTvSnapshot({
    project: {
      id: options.tenancy.project.id,
      displayName: options.tenancy.project.display_name,
    },
    profile,
    now,
    presentation,
    includeScreenDurations: options.includeScreenDurations,
    screens: {
      livePulse,
      audience: audience.screen,
      revenue: revenue.screen,
      email: email.screen,
    },
  });
}
