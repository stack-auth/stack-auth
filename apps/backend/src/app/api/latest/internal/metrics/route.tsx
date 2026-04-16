import { Prisma } from "@/generated/prisma/client";
import { EmailOutboxSimpleStatus } from "@/generated/prisma/enums";
import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { ClickHouseError } from "@clickhouse/client";
import { ActivitySplit, buildSplitFromDailyEntitySets } from "@/lib/metrics-activity-split";
import { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, sqlQuoteIdent } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import {
  type MetricsDataPoint,
  MetricsAnalyticsOverviewSchema,
  MetricsAuthOverviewSchema,
  MetricsDataPointsSchema as DataPointsSchema,
  MetricsEmailOverviewSchema,
  MetricsLoginMethodEntrySchema,
  MetricsPaymentsOverviewSchema,
  MetricsRecentUserSchema,
} from "@stackframe/stack-shared/dist/interface/admin-metrics";
import { captureError, StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { isUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupRecord, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { userFullInclude, userPrismaToCrud, usersCrudHandlers } from "../../users/crud";

type DataPoints = MetricsDataPoint[];

const MAX_USERS_FOR_COUNTRY_SAMPLE = 10_000;
const METRICS_WINDOW_DAYS = 30;
const METRICS_WINDOW_MS = METRICS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const METRICS_REVENUE_INVOICE_STATUSES = ["paid", "succeeded"] as const;
const METRICS_REVENUE_INVOICE_STATUSES_SQL = Prisma.raw(
  METRICS_REVENUE_INVOICE_STATUSES.map((status) => `'${status}'`).join(", "),
);
const METRICS_REVENUE_INVOICE_STATUS_SET = new Set<string>(METRICS_REVENUE_INVOICE_STATUSES);

export function isMetricsRevenueInvoiceStatus(status: string | null | undefined): boolean {
  return status != null && METRICS_REVENUE_INVOICE_STATUS_SET.has(status);
}

export function getMetricsWindowBounds(now: Date): {
  todayUtc: Date,
  since: Date,
  untilExclusive: Date,
} {
  const todayUtc = new Date(now);
  todayUtc.setUTCHours(0, 0, 0, 0);
  return {
    todayUtc,
    since: new Date(todayUtc.getTime() - METRICS_WINDOW_MS),
    untilExclusive: new Date(todayUtc.getTime() + ONE_DAY_MS),
  };
}

function formatClickhouseDateTimeParam(date: Date): string {
  // ClickHouse DateTime params are passed as "YYYY-MM-DDTHH:MM:SS" (no timezone); treat them as UTC.
  return date.toISOString().slice(0, 19);
}

function normalizeUuidFromEvent(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return isUuid(normalized) ? normalized : null;
}

async function loadUsersByCountry(tenancy: Tenancy, includeAnonymous: boolean = false): Promise<Record<string, number>> {
  const clickhouseClient = getClickhouseAdminClient();
  const res = await clickhouseClient.query({
    query: `
      SELECT
        country_code,
        count() AS userCount
      FROM (
        SELECT
          user_id,
          argMax(cc, event_at) AS country_code
        FROM (
          SELECT
            user_id,
            event_at,
            CAST(data.ip_info.country_code, 'Nullable(String)') AS cc,
            CAST(data.is_anonymous, 'UInt8') AS is_anonymous
          FROM analytics_internal.events
          WHERE event_type = '$token-refresh'
            AND project_id = {projectId:String}
            AND branch_id = {branchId:String}
            AND user_id IS NOT NULL
        )
        WHERE cc IS NOT NULL
          AND ({includeAnonymous:UInt8} = 1 OR is_anonymous = 0)
        GROUP BY user_id
      )
      WHERE country_code IS NOT NULL
      GROUP BY country_code
      ORDER BY userCount DESC
    `,
    query_params: {
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      includeAnonymous: includeAnonymous ? 1 : 0,
    },
    format: "JSONEachRow",
  });
  const rows: { country_code: string, userCount: number }[] = await res.json();

  return Object.fromEntries(
    rows.map(({ userCount, country_code }) => {
      if (!country_code) {
        return null;
      }
      const count = Number(userCount);
      return [country_code, count] as [string, number];
    })
      .filter((entry): entry is [string, number] => entry !== null)
  );
}

async function loadTotalUsers(tenancy: Tenancy, now: Date, includeAnonymous: boolean = false): Promise<DataPoints> {
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);
  return (await prisma.$replica().$queryRaw<{ date: Date, dailyUsers: bigint, cumUsers: bigint }[]>`
    WITH date_series AS (
        SELECT GENERATE_SERIES(
          ${now}::date - INTERVAL '30 days',
          ${now}::date,
          '1 day'
        )
        AS registration_day
    )
    SELECT 
      ds.registration_day AS "date",
      COALESCE(COUNT(pu."projectUserId"), 0) AS "dailyUsers",
      SUM(COALESCE(COUNT(pu."projectUserId"), 0)) OVER (ORDER BY ds.registration_day) AS "cumUsers"
    FROM date_series ds
    LEFT JOIN ${sqlQuoteIdent(schema)}."ProjectUser" pu
    ON DATE(COALESCE(pu."signedUpAt", pu."createdAt")) = ds.registration_day
      AND pu."tenancyId" = ${tenancy.id}::UUID
      AND (${includeAnonymous} OR pu."isAnonymous" = false)
    GROUP BY ds.registration_day
    ORDER BY ds.registration_day
  `).map((x) => ({
    date: x.date.toISOString().split('T')[0],
    activity: Number(x.dailyUsers),
  }));
}

async function loadDailyActiveUsers(tenancy: Tenancy, now: Date, includeAnonymous: boolean = false) {
  const todayUtc = new Date(now);
  todayUtc.setUTCHours(0, 0, 0, 0);
  const since = new Date(todayUtc.getTime() - METRICS_WINDOW_MS);
  const untilExclusive = new Date(todayUtc.getTime() + ONE_DAY_MS);

  const clickhouseClient = getClickhouseAdminClient();
  const result = await clickhouseClient.query({
    query: `
      SELECT
        toDate(event_at) AS day,
        uniqExact(assumeNotNull(user_id)) AS dau
      FROM analytics_internal.events
      WHERE event_type = '$token-refresh'
        AND project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND user_id IS NOT NULL
        AND event_at >= {since:DateTime}
        AND event_at < {untilExclusive:DateTime}
        AND ({includeAnonymous:UInt8} = 1 OR JSONExtract(toJSONString(data), 'is_anonymous', 'UInt8') = 0)
      GROUP BY day
      ORDER BY day ASC
    `,
    query_params: {
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      since: formatClickhouseDateTimeParam(since),
      untilExclusive: formatClickhouseDateTimeParam(untilExclusive),
      includeAnonymous: includeAnonymous ? 1 : 0,
    },
    format: "JSONEachRow",
  });

  const rows: { day: string, dau: number }[] = await result.json();
  const dauByDay = new Map<string, number>();
  for (const row of rows) {
    // ClickHouse returns dates/datetimes without timezone, treat as UTC.
    const dayKey = row.day.split('T')[0];
    dauByDay.set(dayKey, Number(row.dau));
  }

  const out: DataPoints = [];
  for (let i = 0; i <= METRICS_WINDOW_DAYS; i += 1) {
    const day = new Date(since.getTime() + i * ONE_DAY_MS);
    const dayKey = day.toISOString().split('T')[0];
    out.push({
      date: dayKey,
      activity: dauByDay.get(dayKey) ?? 0,
    });
  }
  return out;
}

async function loadDailyActiveUsersSplit(tenancy: Tenancy, now: Date, includeAnonymous: boolean): Promise<ActivitySplit> {
  const todayUtc = new Date(now);
  todayUtc.setUTCHours(0, 0, 0, 0);
  const since = new Date(todayUtc.getTime() - METRICS_WINDOW_MS);
  const untilExclusive = new Date(todayUtc.getTime() + ONE_DAY_MS);
  const clickhouseClient = getClickhouseAdminClient();
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);

  const userRows = await clickhouseClient.query({
    query: `
      SELECT
        toDate(event_at) AS day,
        assumeNotNull(user_id) AS user_id
      FROM analytics_internal.events
      WHERE event_type = '$token-refresh'
        AND project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND user_id IS NOT NULL
        AND event_at >= {since:DateTime}
        AND event_at < {untilExclusive:DateTime}
        AND ({includeAnonymous:UInt8} = 1 OR JSONExtract(toJSONString(data), 'is_anonymous', 'UInt8') = 0)
      GROUP BY day, user_id
    `,
    query_params: {
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      since: formatClickhouseDateTimeParam(since),
      untilExclusive: formatClickhouseDateTimeParam(untilExclusive),
      includeAnonymous: includeAnonymous ? 1 : 0,
    },
    format: "JSONEachRow",
  }).then((result) => result.json() as Promise<{ day: string, user_id: string }[]>);

  const sanitizedUserRows = userRows.flatMap((row) => {
    const userId = normalizeUuidFromEvent(row.user_id);
    if (userId == null) {
      return [];
    }
    return [{ ...row, user_id: userId }];
  });

  const activeUserIds = [...new Set(sanitizedUserRows.map((row) => row.user_id))];
  const users: { projectUserId: string, signedUpAtOrCreatedAt: Date }[] = activeUserIds.length === 0
    ? []
    : await prisma.$replica().$queryRaw<{ projectUserId: string, signedUpAtOrCreatedAt: Date }[]>`
        SELECT
          "projectUserId"::text AS "projectUserId",
          COALESCE("signedUpAt", "createdAt") AS "signedUpAtOrCreatedAt"
        FROM ${sqlQuoteIdent(schema)}."ProjectUser"
        WHERE "tenancyId" = ${tenancy.id}::UUID
          AND "projectUserId" IN (${Prisma.join(activeUserIds.map((id) => Prisma.sql`${id}::UUID`))})
          ${includeAnonymous ? Prisma.empty : Prisma.sql`AND "isAnonymous" = false`}
      `;

  const orderedDays: string[] = [];
  const idsByDay = new Map<string, Set<string>>();
  for (let i = 0; i <= METRICS_WINDOW_DAYS; i += 1) {
    const date = new Date(since.getTime() + i * ONE_DAY_MS).toISOString().split('T')[0];
    orderedDays.push(date);
    idsByDay.set(date, new Set<string>());
  }
  for (const row of sanitizedUserRows) {
    const day = row.day.split('T')[0];
    const daySet = idsByDay.get(day);
    if (daySet) {
      daySet.add(row.user_id);
    }
  }

  const createdDayByUserId = new Map<string, string>(
    users.map((user) => [user.projectUserId, user.signedUpAtOrCreatedAt.toISOString().split('T')[0]])
  );

  return buildSplitFromDailyEntitySets({
    orderedDays,
    entityIdsByDay: idsByDay,
    createdDayByEntityId: createdDayByUserId,
  });
}

async function loadDailyActiveTeamsSplit(tenancy: Tenancy, now: Date): Promise<ActivitySplit> {
  const todayUtc = new Date(now);
  todayUtc.setUTCHours(0, 0, 0, 0);
  const since = new Date(todayUtc.getTime() - METRICS_WINDOW_MS);
  const untilExclusive = new Date(todayUtc.getTime() + ONE_DAY_MS);
  const clickhouseClient = getClickhouseAdminClient();
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);

  const teamRows = await clickhouseClient.query({
    query: `
      SELECT
        toDate(event_at) AS day,
        assumeNotNull(team_id) AS team_id
      FROM analytics_internal.events
      WHERE event_type = '$token-refresh'
        AND project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND team_id IS NOT NULL
        AND event_at >= {since:DateTime}
        AND event_at < {untilExclusive:DateTime}
      GROUP BY day, team_id
    `,
    query_params: {
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      since: formatClickhouseDateTimeParam(since),
      untilExclusive: formatClickhouseDateTimeParam(untilExclusive),
    },
    format: "JSONEachRow",
  }).then((result) => result.json() as Promise<{ day: string, team_id: string }[]>);

  const sanitizedTeamRows = teamRows.flatMap((row) => {
    const teamId = normalizeUuidFromEvent(row.team_id);
    if (teamId == null) {
      return [];
    }
    return [{ ...row, team_id: teamId }];
  });

  const activeTeamIds = [...new Set(sanitizedTeamRows.map((row) => row.team_id))];
  const teams: { teamId: string, createdAt: Date }[] = activeTeamIds.length === 0
    ? []
    : await prisma.$replica().$queryRaw<{ teamId: string, createdAt: Date }[]>`
        SELECT "teamId"::text AS "teamId", "createdAt"
        FROM ${sqlQuoteIdent(schema)}."Team"
        WHERE "tenancyId" = ${tenancy.id}::UUID
          AND "teamId" IN (${Prisma.join(activeTeamIds.map((id) => Prisma.sql`${id}::UUID`))})
      `;

  const orderedDays: string[] = [];
  const idsByDay = new Map<string, Set<string>>();
  for (let i = 0; i <= METRICS_WINDOW_DAYS; i += 1) {
    const date = new Date(since.getTime() + i * ONE_DAY_MS).toISOString().split('T')[0];
    orderedDays.push(date);
    idsByDay.set(date, new Set<string>());
  }
  for (const row of sanitizedTeamRows) {
    const day = row.day.split('T')[0];
    const daySet = idsByDay.get(day);
    if (daySet) {
      daySet.add(row.team_id);
    }
  }

  const createdDayByTeamId = new Map<string, string>(
    teams.map((team) => [team.teamId, team.createdAt.toISOString().split('T')[0]])
  );

  return buildSplitFromDailyEntitySets({
    orderedDays,
    entityIdsByDay: idsByDay,
    createdDayByEntityId: createdDayByTeamId,
  });
}

async function loadLoginMethods(tenancy: Tenancy): Promise<{ method: string, count: number }[]> {
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);
  return await prisma.$replica().$queryRaw<{ method: string, count: number }[]>`
    WITH tab AS (
      SELECT
        COALESCE(
          CASE WHEN oaam IS NOT NULL THEN oaam."configOAuthProviderId"::text ELSE NULL END,
          CASE WHEN pam IS NOT NULL THEN 'password' ELSE NULL END,
          CASE WHEN pkm IS NOT NULL THEN 'passkey' ELSE NULL END,
          CASE WHEN oam IS NOT NULL THEN 'otp' ELSE NULL END,
          'other'
        ) AS "method",
        method.id AS id
      FROM
        ${sqlQuoteIdent(schema)}."AuthMethod" method
      LEFT JOIN ${sqlQuoteIdent(schema)}."OAuthAuthMethod" oaam ON method.id = oaam."authMethodId"
      LEFT JOIN ${sqlQuoteIdent(schema)}."PasswordAuthMethod" pam ON method.id = pam."authMethodId"
      LEFT JOIN ${sqlQuoteIdent(schema)}."PasskeyAuthMethod" pkm ON method.id = pkm."authMethodId"
      LEFT JOIN ${sqlQuoteIdent(schema)}."OtpAuthMethod" oam ON method.id = oam."authMethodId"
      WHERE method."tenancyId" = ${tenancy.id}::UUID)
    SELECT LOWER("method") AS method, COUNT(id)::int AS "count" FROM tab
    GROUP BY "method"
  `;
}

async function loadRecentlyActiveUsers(tenancy: Tenancy, includeAnonymous: boolean = false): Promise<UsersCrud["Admin"]["Read"][]> {
  const prisma = await getPrismaClientForTenancy(tenancy);
  const dbUsers = await prisma.projectUser.findMany({
    where: {
      tenancyId: tenancy.id,
      ...(!includeAnonymous ? { isAnonymous: false } : {}),
    },
    orderBy: {
      lastActiveAt: 'desc',
    },
    take: 5,
    include: userFullInclude,
  });

  return dbUsers.map((user) => userPrismaToCrud(user, tenancy.config));
}

// Fallback visitor counts derived purely from `$token-refresh` events so the
// "Unique Visitors" card can render a number for projects without the analytics
// app installed (no `$page-view` events). Always counts anonymous sessions only
// — non-anon users are already represented by MAU/DAU, and the value here is to
// surface anonymous traffic that otherwise wouldn't be visible.
async function loadAnonymousVisitorsFromTokenRefresh(
  tenancy: Tenancy,
  now: Date,
): Promise<{ dailyVisitors: DataPoints, visitors: number }> {
  const { since, untilExclusive } = getMetricsWindowBounds(now);
  const clickhouseClient = getClickhouseAdminClient();

  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT
          toDate(event_at) AS day,
          assumeNotNull(user_id) AS user_id
        FROM analytics_internal.events
        WHERE event_type = '$token-refresh'
          AND project_id = {projectId:String}
          AND branch_id = {branchId:String}
          AND user_id IS NOT NULL
          AND event_at >= {since:DateTime}
          AND event_at < {untilExclusive:DateTime}
          AND JSONExtract(toJSONString(data), 'is_anonymous', 'UInt8') = 1
        GROUP BY day, user_id
      `,
      query_params: {
        projectId: tenancy.project.id,
        branchId: tenancy.branchId,
        since: formatClickhouseDateTimeParam(since),
        untilExclusive: formatClickhouseDateTimeParam(untilExclusive),
      },
      format: "JSONEachRow",
    });
    const rows: { day: string, user_id: string }[] = await result.json();

    const idsByDay = new Map<string, Set<string>>();
    const allIds = new Set<string>();
    for (const row of rows) {
      const userId = normalizeUuidFromEvent(row.user_id);
      if (userId == null) continue;
      const day = row.day.split('T')[0];
      let set = idsByDay.get(day);
      if (set == null) {
        set = new Set<string>();
        idsByDay.set(day, set);
      }
      set.add(userId);
      allIds.add(userId);
    }

    const dailyVisitors: DataPoints = [];
    for (let i = 0; i <= METRICS_WINDOW_DAYS; i += 1) {
      const date = new Date(since.getTime() + i * ONE_DAY_MS).toISOString().split('T')[0];
      dailyVisitors.push({ date, activity: idsByDay.get(date)?.size ?? 0 });
    }

    return { dailyVisitors, visitors: allIds.size };
  } catch (error) {
    if (!(error instanceof ClickHouseError)) {
      throw error;
    }
    captureError("internal-metrics-load-anonymous-visitors-fallback-failed", new StackAssertionError(
      "Failed to load anonymous visitors fallback for internal metrics.",
      {
        cause: error,
        projectId: tenancy.project.id,
        branchId: tenancy.branchId,
      },
    ));
    return { dailyVisitors: [], visitors: 0 };
  }
}

async function loadMonthlyActiveUsers(tenancy: Tenancy, now: Date, includeAnonymous: boolean = false): Promise<number> {
  const { since, untilExclusive } = getMetricsWindowBounds(now);

  const clickhouseClient = getClickhouseAdminClient();
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT
          assumeNotNull(user_id) AS user_id
        FROM analytics_internal.events
        WHERE event_type = '$token-refresh'
          AND project_id = {projectId:String}
          AND branch_id = {branchId:String}
          AND user_id IS NOT NULL
          AND event_at >= {since:DateTime}
          AND event_at < {untilExclusive:DateTime}
          AND ({includeAnonymous:UInt8} = 1 OR JSONExtract(toJSONString(data), 'is_anonymous', 'UInt8') = 0)
        GROUP BY user_id
      `,
      query_params: {
        projectId: tenancy.project.id,
        branchId: tenancy.branchId,
        since: formatClickhouseDateTimeParam(since),
        untilExclusive: formatClickhouseDateTimeParam(untilExclusive),
        includeAnonymous: includeAnonymous ? 1 : 0,
      },
      format: "JSONEachRow",
    });
    const rows: { user_id: string }[] = await result.json();
    const uniqueUserIds = new Set<string>();
    for (const row of rows) {
      const normalizedUserId = normalizeUuidFromEvent(row.user_id);
      if (normalizedUserId != null) {
        uniqueUserIds.add(normalizedUserId);
      }
    }
    return uniqueUserIds.size;
  } catch (error) {
    // Only swallow real ClickHouse errors (e.g. project hasn't enabled
    // analytics yet, transient query failure). Anything else is a programming
    // bug and should propagate to the smart route handler.
    if (!(error instanceof ClickHouseError)) {
      throw error;
    }
    captureError("internal-metrics-load-monthly-active-users-failed", new StackAssertionError(
      "Failed to load monthly active users for internal metrics.",
      {
        cause: error,
        projectId: tenancy.project.id,
        branchId: tenancy.branchId,
      },
    ));
    return 0;
  }
}


async function loadDailyRevenue(tenancy: Tenancy, now: Date): Promise<Array<{ date: string, new_cents: number, refund_cents: number }>> {
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);
  const { since } = getMetricsWindowBounds(now);

  const rows = await prisma.$replica().$queryRaw<{ day: string, new_cents: bigint }[]>`
    SELECT
      TO_CHAR("createdAt"::date, 'YYYY-MM-DD') AS day,
      COALESCE(SUM("amountTotal"), 0)::bigint AS new_cents
    FROM ${sqlQuoteIdent(schema)}."SubscriptionInvoice"
    WHERE "tenancyId" = ${tenancy.id}::UUID
      AND "amountTotal" IS NOT NULL
      AND "status" IN (${METRICS_REVENUE_INVOICE_STATUSES_SQL})
      AND "createdAt" >= ${since}
    GROUP BY day
    ORDER BY day
  `;

  const revenueByDay = new Map<string, number>();
  for (const row of rows) {
    revenueByDay.set(row.day, Number(row.new_cents));
  }

  const dailyRevenue: Array<{ date: string, new_cents: number, refund_cents: number }> = [];
  for (let i = 0; i <= METRICS_WINDOW_DAYS; i++) {
    const day = new Date(since.getTime() + i * ONE_DAY_MS);
    const key = day.toISOString().split('T')[0];
    dailyRevenue.push({ date: key, new_cents: revenueByDay.get(key) ?? 0, refund_cents: 0 });
  }

  return dailyRevenue;
}

async function loadPaymentsOverview(tenancy: Tenancy, now: Date) {
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);

  const { since: thirtyDaysAgo } = getMetricsWindowBounds(now);

  const [
    subscriptionsByStatus,
    aggregates,
    dailySubscriptionRows,
  ] = await Promise.all([
    prisma.$replica().$queryRaw<{ status: string, cnt: number }[]>`
      SELECT "status"::text AS status, COUNT(*)::int AS cnt
      FROM ${sqlQuoteIdent(schema)}."Subscription"
      WHERE "tenancyId" = ${tenancy.id}::UUID
      GROUP BY "status"
    `,
    prisma.$replica().$queryRaw<[{
      active_subscription_count: number,
      total_one_time_purchases: number,
      revenue_cents: bigint,
      total_subscription_invoices: number,
      successful_subscription_invoices: number,
      mrr_cents: bigint,
    }]>`
      SELECT
        (SELECT COUNT(*)::int
          FROM ${sqlQuoteIdent(schema)}."Subscription"
          WHERE "tenancyId" = ${tenancy.id}::UUID
            AND "status" = 'active'::"SubscriptionStatus") AS active_subscription_count,
        (SELECT COUNT(*)::int
          FROM ${sqlQuoteIdent(schema)}."OneTimePurchase"
          WHERE "tenancyId" = ${tenancy.id}::UUID) AS total_one_time_purchases,
        (SELECT COALESCE(SUM("amountTotal"), 0)::bigint
          FROM ${sqlQuoteIdent(schema)}."SubscriptionInvoice"
          WHERE "tenancyId" = ${tenancy.id}::UUID
            AND "amountTotal" IS NOT NULL
            AND "status" IN (${METRICS_REVENUE_INVOICE_STATUSES_SQL})) AS revenue_cents,
        (SELECT COUNT(*)::int
          FROM ${sqlQuoteIdent(schema)}."SubscriptionInvoice"
          WHERE "tenancyId" = ${tenancy.id}::UUID) AS total_subscription_invoices,
        (SELECT COUNT(*)::int
          FROM ${sqlQuoteIdent(schema)}."SubscriptionInvoice"
          WHERE "tenancyId" = ${tenancy.id}::UUID
            AND "status" IN (${METRICS_REVENUE_INVOICE_STATUSES_SQL})) AS successful_subscription_invoices,
        (SELECT COALESCE(SUM("amountTotal"), 0)::bigint
          FROM ${sqlQuoteIdent(schema)}."SubscriptionInvoice"
          WHERE "tenancyId" = ${tenancy.id}::UUID
            AND "amountTotal" IS NOT NULL
            AND "status" IN (${METRICS_REVENUE_INVOICE_STATUSES_SQL})
            AND "createdAt" >= ${thirtyDaysAgo}) AS mrr_cents
    `,
    // Daily subscription signups for the last 30 days
    prisma.$replica().$queryRaw<{ day: string, cnt: number }[]>`
      SELECT
        TO_CHAR("createdAt"::date, 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS cnt
      FROM ${sqlQuoteIdent(schema)}."Subscription"
      WHERE "tenancyId" = ${tenancy.id}::UUID
        AND "createdAt" >= ${thirtyDaysAgo}
      GROUP BY day
      ORDER BY day
    `,
  ]);

  const subsByStatusMap = new Map<string, number>();
  for (const group of subscriptionsByStatus) {
    subsByStatusMap.set(group.status.toLowerCase(), Number(group.cnt));
  }
  const subsByStatus = Object.fromEntries(subsByStatusMap);

  const activeSubscriptionCount = Number(aggregates[0].active_subscription_count);
  const totalOneTimePurchases = Number(aggregates[0].total_one_time_purchases);
  const invoiceRevenueCents = Number(aggregates[0].revenue_cents);
  const totalSubscriptionInvoices = Number(aggregates[0].total_subscription_invoices);
  const successfulSubscriptionInvoices = Number(aggregates[0].successful_subscription_invoices);
  const mrrCents = Number(aggregates[0].mrr_cents);

  const recentByDay = new Map<string, number>();
  for (const row of dailySubscriptionRows) {
    recentByDay.set(row.day, Number(row.cnt));
  }
  const dailySubscriptions: DataPoints = [];
  for (let i = 0; i <= METRICS_WINDOW_DAYS; i++) {
    const day = new Date(thirtyDaysAgo.getTime() + i * ONE_DAY_MS);
    const key = day.toISOString().split('T')[0];
    dailySubscriptions.push({ date: key, activity: recentByDay.get(key) ?? 0 });
  }

  // MRR proxy: trailing-30-day paid invoice revenue. This is an approximation
  // (it conflates one-time and recurring revenue and ignores billing cadence)
  // but it is derived from real data instead of a hardcoded per-subscription rate.
  const totalOrders = totalOneTimePurchases + totalSubscriptionInvoices;
  const checkoutConversionRate = totalOrders > 0
    ? Number((((successfulSubscriptionInvoices + totalOneTimePurchases) / totalOrders) * 100).toFixed(2))
    : 0;

  return {
    subscriptions_by_status: subsByStatus,
    active_subscription_count: activeSubscriptionCount,
    total_one_time_purchases: totalOneTimePurchases,
    daily_subscriptions: dailySubscriptions,
    revenue_cents: invoiceRevenueCents,
    mrr_cents: mrrCents,
    total_orders: totalOrders,
    checkout_conversion_rate: checkoutConversionRate,
  };
}

// ── Email Aggregates ─────────────────────────────────────────────────────────

async function loadEmailOverview(tenancy: Tenancy, now: Date) {
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);
  const { since: thirtyDaysAgo } = getMetricsWindowBounds(now);

  const [
    counts,
    recentEmails,
    emailsByDayAndStatus,
  ] = await Promise.all([
    // Single scan: per-status counts + delivered/bounced/clicked/finishedSending counts
    prisma.$replica().$queryRaw<[{
      ok_count: number,
      error_count: number,
      in_progress_count: number,
      delivered_count: number,
      bounced_count: number,
      clicked_count: number,
      finished_sending_count: number,
    }]>`
      SELECT
        COUNT(*) FILTER (WHERE "simpleStatus" = 'OK'::"EmailOutboxSimpleStatus")::int AS ok_count,
        COUNT(*) FILTER (WHERE "simpleStatus" = 'ERROR'::"EmailOutboxSimpleStatus")::int AS error_count,
        COUNT(*) FILTER (WHERE "simpleStatus" = 'IN_PROGRESS'::"EmailOutboxSimpleStatus")::int AS in_progress_count,
        COUNT(*) FILTER (WHERE "deliveredAt" IS NOT NULL)::int AS delivered_count,
        COUNT(*) FILTER (WHERE "bouncedAt" IS NOT NULL)::int AS bounced_count,
        COUNT(*) FILTER (WHERE "clickedAt" IS NOT NULL)::int AS clicked_count,
        COUNT(*) FILTER (WHERE "finishedSendingAt" IS NOT NULL)::int AS finished_sending_count
      FROM ${sqlQuoteIdent(schema)}."EmailOutbox"
      WHERE "tenancyId" = ${tenancy.id}::UUID
    `,
    prisma.$replica().$queryRaw<{
      id: string,
      createdAt: Date,
      simpleStatus: string,
      status: string,
      renderedSubject: string | null,
    }[]>`
      SELECT
        "id"::text AS id,
        "createdAt",
        "simpleStatus"::text AS "simpleStatus",
        "status"::text AS "status",
        "renderedSubject"
      FROM ${sqlQuoteIdent(schema)}."EmailOutbox"
      WHERE "tenancyId" = ${tenancy.id}::UUID
      ORDER BY "createdAt" DESC
      LIMIT ${RECENT_LIST_PAGE_SIZE}
    `,
    // Per-day per-simpleStatus counts for the last 30 days
    prisma.$replica().$queryRaw<{ day: string, status: string, cnt: number }[]>`
      SELECT
        TO_CHAR("createdAt"::date, 'YYYY-MM-DD') AS day,
        "simpleStatus"::text AS status,
        COUNT(*)::int AS cnt
      FROM ${sqlQuoteIdent(schema)}."EmailOutbox"
      WHERE "tenancyId" = ${tenancy.id}::UUID
        AND "createdAt" >= ${thirtyDaysAgo}
      GROUP BY day, "simpleStatus"
      ORDER BY day
    `,
  ]);

  const deliveredCount = Number(counts[0].delivered_count);
  const bouncedCount = Number(counts[0].bounced_count);
  const clickedCount = Number(counts[0].clicked_count);
  const finishedSendingCount = Number(counts[0].finished_sending_count);

  // Match the original groupBy behavior: only include statuses that actually
  // have at least one row, mirroring what Prisma's groupBy used to return.
  const emailsByStatus: Record<string, number> = {};
  const okCount = Number(counts[0].ok_count);
  const errorCount = Number(counts[0].error_count);
  const inProgressCount = Number(counts[0].in_progress_count);
  if (okCount > 0) emailsByStatus.ok = okCount;
  if (errorCount > 0) emailsByStatus.error = errorCount;
  if (inProgressCount > 0) emailsByStatus['in-progress'] = inProgressCount;

  // Daily email sends for last 30 days
  const emailByDay = new Map<string, number>();
  for (const row of emailsByDayAndStatus) {
    emailByDay.set(row.day, (emailByDay.get(row.day) ?? 0) + Number(row.cnt));
  }
  const dailyEmails: DataPoints = [];
  for (let i = 0; i <= METRICS_WINDOW_DAYS; i++) {
    const day = new Date(thirtyDaysAgo.getTime() + i * ONE_DAY_MS);
    const key = day.toISOString().split('T')[0];
    dailyEmails.push({ date: key, activity: emailByDay.get(key) ?? 0 });
  }

  const totalEmails = Object.values(emailsByStatus).reduce((a, b) => a + b, 0);
  const denom = finishedSendingCount > 0 ? finishedSendingCount : 1;
  const deliverabilityRate = Number((Math.min(deliveredCount / denom, 1) * 100).toFixed(2));
  const bounceRate = Number((Math.min(bouncedCount / denom, 1) * 100).toFixed(2));
  const clickRate = Number((Math.min(clickedCount / denom, 1) * 100).toFixed(2));

  // Build per-day per-status breakdown for stacked bar chart
  type DayStatusCounts = { date: string, ok: number, error: number, in_progress: number };
  const dayStatusMap = new Map<string, { ok: number, error: number, in_progress: number }>();
  for (let i = 0; i <= METRICS_WINDOW_DAYS; i++) {
    const key = new Date(thirtyDaysAgo.getTime() + i * ONE_DAY_MS).toISOString().split('T')[0];
    dayStatusMap.set(key, { ok: 0, error: 0, in_progress: 0 });
  }
  for (const row of emailsByDayAndStatus) {
    const entry = dayStatusMap.get(row.day);
    if (entry == null) continue;
    const count = Number(row.cnt);
    // Exhaustive switch over EmailOutboxSimpleStatus — adding a new enum
    // value will fail typecheck here so we can't silently miscount.
    const status = row.status as EmailOutboxSimpleStatus;
    switch (status) {
      case 'OK': {
        entry.ok += count;
        break;
      }
      case 'ERROR': {
        entry.error += count;
        break;
      }
      case 'IN_PROGRESS': {
        entry.in_progress += count;
        break;
      }
      default: {
        const _exhaustiveCheck: never = status;
        captureError("internal-metrics-unknown-email-simple-status", new StackAssertionError(
          `Unknown EmailOutboxSimpleStatus value: ${String(_exhaustiveCheck)}`,
          { status: _exhaustiveCheck },
        ));
      }
    }
  }
  const dailyEmailsByStatus: DayStatusCounts[] = [...dayStatusMap.entries()].map(([date, counts]) => ({
    date,
    ...counts,
  }));

  return {
    emails_by_status: emailsByStatus,
    total_emails: totalEmails,
    daily_emails: dailyEmails,
    daily_emails_by_status: dailyEmailsByStatus,
    emails_sent: finishedSendingCount,
    recent_emails: recentEmails.map((email) => ({
      id: email.id,
      status: email.status,
      subject: email.renderedSubject ?? '(no subject)',
      created_at_millis: email.createdAt.getTime(),
    })),
    deliverability_status: {
      delivered: deliveredCount,
      bounced: bouncedCount,
      error: emailsByStatus['error'] ?? 0,
      in_progress: emailsByStatus['in-progress'] ?? 0,
    },
    deliverability_rate: deliverabilityRate,
    bounce_rate: bounceRate,
    click_rate: clickRate,
  };
}

// ── Web Analytics Aggregates ─────────────────────────────────────────────────

type SessionReplayAggregates = {
  total: number,
  recent: number,
  avgSessionSeconds: number,
  totalRevenueCents: number,
};

async function loadSessionReplayAggregates(tenancy: Tenancy, since: Date): Promise<SessionReplayAggregates> {
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);
  const result = await prisma.$replica().$queryRaw<[{
    total: number,
    recent: number,
    avg_ms: number | null,
    total_revenue_cents: bigint,
  }]>`
    SELECT
      (SELECT COUNT(*)::int
        FROM ${sqlQuoteIdent(schema)}."SessionReplay"
        WHERE "tenancyId" = ${tenancy.id}::UUID) AS total,
      (SELECT COUNT(*)::int
        FROM ${sqlQuoteIdent(schema)}."SessionReplay"
        WHERE "tenancyId" = ${tenancy.id}::UUID
          AND "startedAt" >= ${since}) AS recent,
      (SELECT AVG(GREATEST(0, EXTRACT(EPOCH FROM ("lastEventAt" - "startedAt")) * 1000))
        FROM ${sqlQuoteIdent(schema)}."SessionReplay"
        WHERE "tenancyId" = ${tenancy.id}::UUID
          AND "startedAt" >= ${since}) AS avg_ms,
      (SELECT COALESCE(SUM("amountTotal"), 0)::bigint
        FROM ${sqlQuoteIdent(schema)}."SubscriptionInvoice"
        WHERE "tenancyId" = ${tenancy.id}::UUID
          AND "amountTotal" IS NOT NULL
          AND "status" IN (${METRICS_REVENUE_INVOICE_STATUSES_SQL})) AS total_revenue_cents
  `;

  const row = result[0];
  const avgSessionSeconds = Number(((Number(row.avg_ms ?? 0)) / 1000).toFixed(1));
  return {
    total: Number(row.total),
    recent: Number(row.recent),
    avgSessionSeconds,
    totalRevenueCents: Number(row.total_revenue_cents),
  };
}

async function loadAnalyticsOverview(tenancy: Tenancy, now: Date, includeAnonymous: boolean) {
  const todayUtc = new Date(now);
  todayUtc.setUTCHours(0, 0, 0, 0);
  const since = new Date(todayUtc.getTime() - METRICS_WINDOW_MS);
  const untilExclusive = new Date(todayUtc.getTime() + ONE_DAY_MS);

  const clickhouseClient = getClickhouseAdminClient();

  // Session replay aggregates come from Postgres and have nothing to do with
  // ClickHouse availability. Run them in parallel with the ClickHouse queries
  // but keep them outside the ClickHouse-only try/catch so a postgres failure
  // never gets misattributed to "analytics not enabled".
  const replayPromise = loadSessionReplayAggregates(tenancy, since);

  // Token-refresh-based anon visitor fallback. Always computed so the frontend
  // can swap it in when the analytics app isn't installed (no `$page-view`
  // events). Has its own error handling so a failure here doesn't take down the
  // primary analytics overview.
  const anonymousVisitorsPromise = loadAnonymousVisitorsFromTokenRefresh(tenancy, now);

  let clickhouseAggregates: {
    dailyPageViews: DataPoints,
    dailyClicks: DataPoints,
    dailyVisitors: DataPoints,
    visitors: number,
    onlineLive: number,
    topReferrers: { referrer: string, visitors: number }[],
    topRegion: { country_code: string | null, region_code: string | null, count: number } | null,
  } | null = null;

  try {
    const analyticsUserJoin = `
      LEFT JOIN (
        SELECT
          user_id,
          argMax(JSONExtract(toJSONString(data), 'is_anonymous', 'UInt8'), event_at) AS latest_is_anonymous
        FROM analytics_internal.events
        WHERE event_type = '$token-refresh'
          AND project_id = {projectId:String}
          AND branch_id = {branchId:String}
          AND user_id IS NOT NULL
          AND event_at < {untilExclusive:DateTime}
        GROUP BY user_id
      ) AS token_refresh_users
        ON e.user_id = token_refresh_users.user_id
    `;
    const nonAnonymousAnalyticsUserFilter = "({includeAnonymous:UInt8} = 1 OR coalesce(JSONExtract(toJSONString(e.data), 'is_anonymous', 'Nullable(UInt8)'), token_refresh_users.latest_is_anonymous, 0) = 0)";
    const [dailyEventResult, totalVisitorResult, referrerResult, topRegionResult, onlineResult] = await Promise.all([
      // Combined daily aggregates: page-view count, click count, and unique
      // visitors per day — one scan over the page-view/click event types.
      clickhouseClient.query({
        query: `
          SELECT
            toDate(e.event_at) AS day,
            countIf(
              e.event_type = '$page-view'
                AND e.user_id IS NOT NULL
                AND ${nonAnonymousAnalyticsUserFilter}
            ) AS pv,
            countIf(
              e.event_type = '$click'
                AND e.user_id IS NOT NULL
                AND ${nonAnonymousAnalyticsUserFilter}
            ) AS cl,
            uniqExactIf(
              assumeNotNull(e.user_id),
              e.event_type = '$page-view'
                AND e.user_id IS NOT NULL
                AND ${nonAnonymousAnalyticsUserFilter}
            ) AS visitors
          FROM analytics_internal.events AS e
          ${analyticsUserJoin}
          WHERE e.event_type IN ('$page-view', '$click')
            AND e.project_id = {projectId:String}
            AND e.branch_id = {branchId:String}
            AND e.event_at >= {since:DateTime}
            AND e.event_at < {untilExclusive:DateTime}
          GROUP BY day
          ORDER BY day ASC
        `,
        query_params: {
          since: formatClickhouseDateTimeParam(since),
          untilExclusive: formatClickhouseDateTimeParam(untilExclusive),
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
          includeAnonymous: includeAnonymous ? 1 : 0,
        },
        format: "JSONEachRow",
      }),
      clickhouseClient.query({
        query: `
          SELECT
            uniqExactIf(
              assumeNotNull(e.user_id),
              e.user_id IS NOT NULL
                AND ${nonAnonymousAnalyticsUserFilter}
            ) AS visitors
          FROM analytics_internal.events AS e
          ${analyticsUserJoin}
          WHERE e.event_type = '$page-view'
            AND e.project_id = {projectId:String}
            AND e.branch_id = {branchId:String}
            AND e.user_id IS NOT NULL
            AND e.event_at >= {since:DateTime}
            AND e.event_at < {untilExclusive:DateTime}
        `,
        query_params: {
          since: formatClickhouseDateTimeParam(since),
          untilExclusive: formatClickhouseDateTimeParam(untilExclusive),
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
          includeAnonymous: includeAnonymous ? 1 : 0,
        },
        format: "JSONEachRow",
      }),
      clickhouseClient.query({
        query: `
          SELECT
            nullIf(CAST(e.data.referrer, 'String'), '') AS referrer,
            uniqExactIf(
              assumeNotNull(e.user_id),
              e.user_id IS NOT NULL
                AND ${nonAnonymousAnalyticsUserFilter}
            ) AS visitors
          FROM analytics_internal.events AS e
          ${analyticsUserJoin}
          WHERE e.event_type = '$page-view'
            AND e.project_id = {projectId:String}
            AND e.branch_id = {branchId:String}
            AND e.event_at >= {since:DateTime}
            AND e.event_at < {untilExclusive:DateTime}
          GROUP BY referrer
          HAVING visitors > 0
          ORDER BY visitors DESC
          LIMIT ${TOP_REFERRERS_PAGE_SIZE}
        `,
        query_params: {
          since: formatClickhouseDateTimeParam(since),
          untilExclusive: formatClickhouseDateTimeParam(untilExclusive),
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
          includeAnonymous: includeAnonymous ? 1 : 0,
        },
        format: "JSONEachRow",
      }),
      clickhouseClient.query({
        query: `
          SELECT
            CAST(data.ip_info.country_code, 'Nullable(String)') AS country_code,
            CAST(data.ip_info.region_code, 'Nullable(String)') AS region_code,
            uniqExactIf(
              assumeNotNull(user_id),
              user_id IS NOT NULL
                AND ({includeAnonymous:UInt8} = 1 OR JSONExtract(toJSONString(data), 'is_anonymous', 'UInt8') = 0)
            ) AS visitors
          FROM analytics_internal.events
          WHERE event_type = '$token-refresh'
            AND project_id = {projectId:String}
            AND branch_id = {branchId:String}
            AND user_id IS NOT NULL
            AND event_at >= {since:DateTime}
            AND event_at < {untilExclusive:DateTime}
          GROUP BY country_code, region_code
          HAVING visitors > 0
          ORDER BY visitors DESC
          LIMIT 1
        `,
        query_params: {
          since: formatClickhouseDateTimeParam(since),
          untilExclusive: formatClickhouseDateTimeParam(untilExclusive),
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
          includeAnonymous: includeAnonymous ? 1 : 0,
        },
        format: "JSONEachRow",
      }),
      clickhouseClient.query({
        query: `
          SELECT
            uniqExact(assumeNotNull(user_id)) AS online
          FROM analytics_internal.events
          WHERE event_type = '$token-refresh'
            AND project_id = {projectId:String}
            AND branch_id = {branchId:String}
            AND user_id IS NOT NULL
            AND event_at >= {onlineSince:DateTime}
            AND event_at < {untilExclusive:DateTime}
            AND ({includeAnonymous:UInt8} = 1 OR JSONExtract(toJSONString(data), 'is_anonymous', 'UInt8') = 0)
        `,
        query_params: {
          onlineSince: formatClickhouseDateTimeParam(new Date(now.getTime() - 5 * 60 * 1000)),
          untilExclusive: formatClickhouseDateTimeParam(untilExclusive),
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
          includeAnonymous: includeAnonymous ? 1 : 0,
        },
        format: "JSONEachRow",
      }),
    ]);

    const dailyEventRows: { day: string, pv: number, cl: number, visitors: number }[] = await dailyEventResult.json();
    const pvByDay = new Map<string, number>();
    const clByDay = new Map<string, number>();
    const visitorByDay = new Map<string, number>();
    for (const row of dailyEventRows) {
      const key = row.day.split('T')[0];
      pvByDay.set(key, Number(row.pv));
      clByDay.set(key, Number(row.cl));
      visitorByDay.set(key, Number(row.visitors));
    }
    const totalVisitorRows: { visitors: number }[] = await totalVisitorResult.json();
    const visitors = Number(totalVisitorRows[0]?.visitors ?? 0);

    const dailyPageViews: DataPoints = [];
    const dailyClicks: DataPoints = [];
    const dailyVisitors: DataPoints = [];
    for (let i = 0; i <= METRICS_WINDOW_DAYS; i++) {
      const day = new Date(since.getTime() + i * ONE_DAY_MS);
      const key = day.toISOString().split('T')[0];
      dailyPageViews.push({ date: key, activity: pvByDay.get(key) ?? 0 });
      dailyClicks.push({ date: key, activity: clByDay.get(key) ?? 0 });
      dailyVisitors.push({ date: key, activity: visitorByDay.get(key) ?? 0 });
    }

    const referrers: { referrer: string | null, visitors: number }[] = await referrerResult.json();
    const topRegionRows: { country_code: string | null, region_code: string | null, visitors: number }[] = await topRegionResult.json();
    const onlineRows: { online: number }[] = await onlineResult.json();

    clickhouseAggregates = {
      dailyPageViews,
      dailyClicks,
      dailyVisitors,
      visitors,
      onlineLive: Number(onlineRows[0]?.online ?? 0),
      topReferrers: referrers.map((row) => ({
        referrer: row.referrer ?? '(direct)',
        visitors: Number(row.visitors),
      })),
      topRegion: topRegionRows[0] ? {
        country_code: topRegionRows[0].country_code,
        region_code: topRegionRows[0].region_code,
        count: Number(topRegionRows[0].visitors),
      } : null,
    };
  } catch (error) {
    // Only swallow real ClickHouse errors — that's the "analytics not enabled
    // for this project" path. Anything else is a real bug and should propagate.
    if (!(error instanceof ClickHouseError)) {
      throw error;
    }
    captureError("internal-metrics-analytics-overview-clickhouse-fallback", new StackAssertionError(
      "Falling back to empty analytics overview due to ClickHouse query failure.",
      {
        cause: error,
        projectId: tenancy.project.id,
        branchId: tenancy.branchId,
      },
    ));
    // Leave clickhouseAggregates as null — handled in the response builder below.
  }

  // Postgres-backed session replay query has its own error surface — let it
  // propagate naturally so we don't conflate it with "clickhouse missing".
  const replayResult = await replayPromise;
  const anonymousVisitorsResult = await anonymousVisitorsPromise;

  // daily_revenue is intentionally not populated here — it is owned by
  // payments_overview (real invoice data) and stitched into analytics_overview
  // by the response builder so the dashboard can keep reading it from a single
  // location.
  if (clickhouseAggregates == null) {
    return {
      daily_page_views: [] as DataPoints,
      daily_clicks: [] as DataPoints,
      daily_visitors: [] as DataPoints,
      daily_visitors_fallback: anonymousVisitorsResult.dailyVisitors,
      daily_revenue: [] as Array<{ date: string, new_cents: number, refund_cents: number }>,
      total_revenue_cents: replayResult.totalRevenueCents,
      total_replays: replayResult.total,
      recent_replays: replayResult.recent,
      visitors: 0,
      visitors_fallback: anonymousVisitorsResult.visitors,
      avg_session_seconds: replayResult.avgSessionSeconds,
      online_live: 0,
      revenue_per_visitor: 0,
      top_referrers: [],
      top_region: null,
    };
  }

  return {
    daily_page_views: clickhouseAggregates.dailyPageViews,
    daily_clicks: clickhouseAggregates.dailyClicks,
    daily_visitors: clickhouseAggregates.dailyVisitors,
    daily_visitors_fallback: anonymousVisitorsResult.dailyVisitors,
    daily_revenue: [] as Array<{ date: string, new_cents: number, refund_cents: number }>,
    total_revenue_cents: replayResult.totalRevenueCents,
    total_replays: replayResult.total,
    recent_replays: replayResult.recent,
    visitors: clickhouseAggregates.visitors,
    visitors_fallback: anonymousVisitorsResult.visitors,
    avg_session_seconds: replayResult.avgSessionSeconds,
    online_live: clickhouseAggregates.onlineLive,
    revenue_per_visitor: clickhouseAggregates.visitors > 0
      ? Number(((replayResult.totalRevenueCents / 100) / clickhouseAggregates.visitors).toFixed(2))
      : 0,
    top_referrers: clickhouseAggregates.topReferrers,
    top_region: clickhouseAggregates.topRegion,
  };
}

// ── Auth Extra Aggregates ────────────────────────────────────────────────────

async function loadAuthOverview(tenancy: Tenancy, includeAnonymous: boolean, now: Date) {
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);

  const [counts, dailyActiveUsersSplit, dailyActiveTeamsSplit, mau] = await Promise.all([
    prisma.$replica().$queryRaw<[{
      total_users: number,
      verified_non_anonymous_users: number,
      anonymous_users: number,
      total_teams: number,
    }]>`
      SELECT
        (SELECT COUNT(*)::int
          FROM ${sqlQuoteIdent(schema)}."ProjectUser"
          WHERE "tenancyId" = ${tenancy.id}::UUID) AS total_users,
        (SELECT COUNT(*)::int
          FROM ${sqlQuoteIdent(schema)}."ProjectUser" pu
          WHERE pu."tenancyId" = ${tenancy.id}::UUID
            AND pu."isAnonymous" = false
            AND EXISTS (
              SELECT 1 FROM ${sqlQuoteIdent(schema)}."ContactChannel" cc
              WHERE cc."tenancyId" = pu."tenancyId"
                AND cc."projectUserId" = pu."projectUserId"
                AND cc."type" = 'EMAIL'::"ContactChannelType"
                AND cc."isVerified" = true
            )) AS verified_non_anonymous_users,
        (SELECT COUNT(*)::int
          FROM ${sqlQuoteIdent(schema)}."ProjectUser"
          WHERE "tenancyId" = ${tenancy.id}::UUID
            AND "isAnonymous" = true) AS anonymous_users,
        (SELECT COUNT(*)::int
          FROM ${sqlQuoteIdent(schema)}."Team"
          WHERE "tenancyId" = ${tenancy.id}::UUID) AS total_teams
    `,
    loadDailyActiveUsersSplit(tenancy, now, includeAnonymous),
    loadDailyActiveTeamsSplit(tenancy, now),
    loadMonthlyActiveUsers(tenancy, now, includeAnonymous),
  ]);

  const totalUsers = Number(counts[0].total_users);
  const verifiedNonAnonymousUsers = Number(counts[0].verified_non_anonymous_users);
  const anonymousUsers = Number(counts[0].anonymous_users);
  const totalTeams = Number(counts[0].total_teams);
  const nonAnonymousTotal = totalUsers - anonymousUsers;
  // total_users_filtered respects the includeAnonymous query flag so the
  // handler can use it directly without a separate count round trip.
  const totalUsersFiltered = includeAnonymous ? totalUsers : nonAnonymousTotal;

  // verified_users / unverified_users always count non-anonymous users only,
  // so they never overlap with anonymous_users (which is its own bucket).
  // Adding all three always equals totalUsers, regardless of includeAnonymous.
  return {
    verified_users: verifiedNonAnonymousUsers,
    unverified_users: nonAnonymousTotal - verifiedNonAnonymousUsers,
    anonymous_users: anonymousUsers,
    total_teams: totalTeams,
    mau,
    daily_active_users_split: dailyActiveUsersSplit,
    daily_active_teams_split: dailyActiveTeamsSplit,
    total_users_filtered: totalUsersFiltered,
  };
}

const RECENT_LIST_PAGE_SIZE = 100;
const TOP_REFERRERS_PAGE_SIZE = 100;

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
    query: yupObject({
      include_anonymous: yupString().oneOf(["true", "false"]).optional(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      total_users: yupNumber().integer().defined(),
      daily_users: DataPointsSchema,
      daily_active_users: DataPointsSchema,
      users_by_country: yupRecord(yupString().defined(), yupNumber().defined()).defined(),
      // recently_registered/active are CRUD User objects passed through from
      // usersCrudHandlers. Validated against MetricsRecentUserSchema, which
      // covers the fields the dashboard reads — extra fields from
      // UsersCrud["Admin"]["Read"] flow through.
      recently_registered: yupArray(MetricsRecentUserSchema).defined(),
      recently_active: yupArray(MetricsRecentUserSchema).defined(),
      login_methods: yupArray(MetricsLoginMethodEntrySchema).defined(),
      auth_overview: MetricsAuthOverviewSchema,
      payments_overview: MetricsPaymentsOverviewSchema,
      email_overview: MetricsEmailOverviewSchema,
      analytics_overview: MetricsAnalyticsOverviewSchema,
    }).defined(),
  }),
  handler: async (req) => {
    const now = new Date();
    const includeAnonymous = req.query.include_anonymous === "true";

    const [
      dailyUsers,
      dailyActiveUsers,
      usersByCountry,
      recentlyRegistered,
      recentlyActive,
      loginMethods,
      authOverview,
      paymentsOverview,
      emailOverview,
      analyticsOverview,
      dailyRevenue,
    ] = await Promise.all([
      loadTotalUsers(req.auth.tenancy, now, includeAnonymous),
      loadDailyActiveUsers(req.auth.tenancy, now, includeAnonymous),
      loadUsersByCountry(req.auth.tenancy, includeAnonymous),
      usersCrudHandlers.adminList({
        tenancy: req.auth.tenancy,
        query: {
          order_by: 'signed_up_at',
          desc: "true",
          limit: RECENT_LIST_PAGE_SIZE,
          include_anonymous: includeAnonymous ? "true" : "false",
        },
        allowedErrorTypes: [
          KnownErrors.UserNotFound,
        ],
      }).then(res => res.items),
      loadRecentlyActiveUsers(req.auth.tenancy, includeAnonymous),
      loadLoginMethods(req.auth.tenancy),
      loadAuthOverview(req.auth.tenancy, includeAnonymous, now),
      loadPaymentsOverview(req.auth.tenancy, now),
      loadEmailOverview(req.auth.tenancy, now),
      loadAnalyticsOverview(req.auth.tenancy, now, includeAnonymous),
      loadDailyRevenue(req.auth.tenancy, now),
    ] as const);

    const totalUsers = authOverview.total_users_filtered;

    // Stitch real daily revenue (from paid invoices) into analytics_overview so
    // the dashboard can read it from a single location.
    const finalAnalyticsOverview = { ...analyticsOverview, daily_revenue: dailyRevenue };

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        total_users: totalUsers,
        daily_users: dailyUsers,
        daily_active_users: dailyActiveUsers,
        users_by_country: usersByCountry,
        recently_registered: recentlyRegistered,
        recently_active: recentlyActive,
        login_methods: loginMethods,
        auth_overview: authOverview,
        payments_overview: paymentsOverview,
        email_overview: emailOverview,
        analytics_overview: finalAnalyticsOverview,
      }
    };
  },
});
