import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, sqlQuoteIdent } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import yup from 'yup';
import { userFullInclude, userPrismaToCrud, usersCrudHandlers } from "../../users/crud";

type DataPoints = yup.InferType<typeof DataPointsSchema>;

const MAX_USERS_FOR_COUNTRY_SAMPLE = 10_000;

const DataPointsSchema = yupArray(yupObject({
  date: yupString().defined(),
  activity: yupNumber().defined(),
}).defined()).defined();

function formatClickhouseDateTimeParam(date: Date): string {
  // ClickHouse DateTime params are passed as "YYYY-MM-DDTHH:MM:SS" (no timezone); treat them as UTC.
  return date.toISOString().slice(0, 19);
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
    ON DATE(pu."createdAt") = ds.registration_day 
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
  const since = new Date(todayUtc.getTime() - 30 * 24 * 60 * 60 * 1000);
  const untilExclusive = new Date(todayUtc.getTime() + 24 * 60 * 60 * 1000);

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
    const dayKey = new Date(row.day + 'Z').toISOString().split('T')[0];
    dauByDay.set(dayKey, Number(row.dau));
  }

  const out: DataPoints = [];
  for (let i = 0; i <= 30; i += 1) {
    const day = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    const dayKey = day.toISOString().split('T')[0];
    out.push({
      date: dayKey,
      activity: dauByDay.get(dayKey) ?? 0,
    });
  }
  return out;
}

type ActivitySplit = {
  total: DataPoints,
  new: DataPoints,
  retained: DataPoints,
  reactivated: DataPoints,
};

function createEmptySplitSeries(days: string[]): ActivitySplit {
  const emptySeries = days.map((date) => ({ date, activity: 0 }));
  return {
    total: emptySeries.map((item) => ({ ...item })),
    new: emptySeries.map((item) => ({ ...item })),
    retained: emptySeries.map((item) => ({ ...item })),
    reactivated: emptySeries.map((item) => ({ ...item })),
  };
}

function buildSplitFromDailyEntitySets(options: {
  orderedDays: string[],
  entityIdsByDay: Map<string, Set<string>>,
  createdDayByEntityId?: Map<string, string>,
}): ActivitySplit {
  const { orderedDays, entityIdsByDay, createdDayByEntityId } = options;
  const split = createEmptySplitSeries(orderedDays);
  const previouslySeen = new Set<string>();
  let previousDaySet = new Set<string>();

  for (let i = 0; i < orderedDays.length; i += 1) {
    const day = orderedDays[i];
    const currentDaySet = entityIdsByDay.get(day) ?? new Set<string>();
    let newCount = 0;
    let retainedCount = 0;
    let reactivatedCount = 0;

    for (const entityId of currentDaySet) {
      const createdDay = createdDayByEntityId?.get(entityId);
      if (createdDay === day) {
        newCount += 1;
      } else if (previousDaySet.has(entityId)) {
        retainedCount += 1;
      } else if (previouslySeen.has(entityId)) {
        reactivatedCount += 1;
      } else {
        newCount += 1;
      }
    }

    split.total[i].activity = currentDaySet.size;
    split.new[i].activity = newCount;
    split.retained[i].activity = retainedCount;
    split.reactivated[i].activity = reactivatedCount;

    for (const entityId of currentDaySet) {
      previouslySeen.add(entityId);
    }
    previousDaySet = currentDaySet;
  }

  return split;
}

async function loadDailyActiveUsersSplit(tenancy: Tenancy, now: Date, includeAnonymous: boolean): Promise<ActivitySplit> {
  const todayUtc = new Date(now);
  todayUtc.setUTCHours(0, 0, 0, 0);
  const since = new Date(todayUtc.getTime() - 30 * 24 * 60 * 60 * 1000);
  const untilExclusive = new Date(todayUtc.getTime() + 24 * 60 * 60 * 1000);
  const clickhouseClient = getClickhouseAdminClient();
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

  const activeUserIds = [...new Set(userRows.map((row) => row.user_id))];
  const users = activeUserIds.length === 0
    ? []
    : await prisma.projectUser.findMany({
      where: {
        tenancyId: tenancy.id,
        projectUserId: { in: activeUserIds },
        ...(includeAnonymous ? {} : { isAnonymous: false }),
      },
      select: {
        projectUserId: true,
        createdAt: true,
      },
    });

  const orderedDays: string[] = [];
  const idsByDay = new Map<string, Set<string>>();
  for (let i = 0; i <= 30; i += 1) {
    const date = new Date(since.getTime() + i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    orderedDays.push(date);
    idsByDay.set(date, new Set<string>());
  }
  for (const row of userRows) {
    const day = new Date(row.day + 'Z').toISOString().split('T')[0];
    const daySet = idsByDay.get(day);
    if (daySet) {
      daySet.add(row.user_id);
    }
  }

  const createdDayByUserId = new Map<string, string>(
    users.map((user) => [user.projectUserId, user.createdAt.toISOString().split('T')[0]])
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
  const since = new Date(todayUtc.getTime() - 30 * 24 * 60 * 60 * 1000);
  const untilExclusive = new Date(todayUtc.getTime() + 24 * 60 * 60 * 1000);
  const clickhouseClient = getClickhouseAdminClient();
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

  const activeTeamIds = [...new Set(teamRows.map((row) => row.team_id))];
  const teams = activeTeamIds.length === 0
    ? []
    : await prisma.team.findMany({
      where: {
        tenancyId: tenancy.id,
        teamId: { in: activeTeamIds },
      },
      select: {
        teamId: true,
        createdAt: true,
      },
    });

  const orderedDays: string[] = [];
  const idsByDay = new Map<string, Set<string>>();
  for (let i = 0; i <= 30; i += 1) {
    const date = new Date(since.getTime() + i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    orderedDays.push(date);
    idsByDay.set(date, new Set<string>());
  }
  for (const row of teamRows) {
    const day = new Date(row.day + 'Z').toISOString().split('T')[0];
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

async function loadMonthlyActiveUsers(tenancy: Tenancy, includeAnonymous: boolean = false): Promise<number> {
  const now = new Date();
  const todayUtc = new Date(now);
  todayUtc.setUTCHours(0, 0, 0, 0);
  // 30-day rolling window for MAU
  const since = new Date(todayUtc.getTime() - 30 * 24 * 60 * 60 * 1000);
  const untilExclusive = new Date(todayUtc.getTime() + 24 * 60 * 60 * 1000);

  const clickhouseClient = getClickhouseAdminClient();
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT
          uniqExact(assumeNotNull(user_id)) AS mau
        FROM analytics_internal.events
        WHERE event_type = '$token-refresh'
          AND project_id = {projectId:String}
          AND branch_id = {branchId:String}
          AND user_id IS NOT NULL
          AND event_at >= {since:DateTime}
          AND event_at < {untilExclusive:DateTime}
          AND ({includeAnonymous:UInt8} = 1 OR JSONExtract(toJSONString(data), 'is_anonymous', 'UInt8') = 0)
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
    const rows: { mau: number }[] = await result.json();
    return Number(rows[0]?.mau ?? 0);
  } catch (error) {
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


async function loadPaymentsOverview(tenancy: Tenancy) {
  const prisma = await getPrismaClientForTenancy(tenancy);

  const [
    subscriptionsByStatus,
    activeSubscriptionCount,
    totalOneTimePurchases,
    recentSubscriptions,
    invoiceRevenue,
    totalSubscriptionInvoices,
    successfulSubscriptionInvoices,
  ] = await Promise.all([
    prisma.subscription.groupBy({
      by: ['status'],
      where: { tenancyId: tenancy.id },
      _count: { _all: true },
    }),
    prisma.subscription.count({
      where: { tenancyId: tenancy.id, status: 'active' },
    }),
    prisma.oneTimePurchase.count({
      where: { tenancyId: tenancy.id },
    }),
    prisma.subscription.findMany({
      where: {
        tenancyId: tenancy.id,
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, status: true, customerType: true, productId: true },
    }),
    prisma.subscriptionInvoice.aggregate({
      where: { tenancyId: tenancy.id, amountTotal: { not: null } },
      _sum: { amountTotal: true },
    }),
    prisma.subscriptionInvoice.count({
      where: { tenancyId: tenancy.id },
    }),
    prisma.subscriptionInvoice.count({
      where: { tenancyId: tenancy.id, status: { in: ['paid', 'succeeded'] } },
    }),
  ]);

  const subsByStatusMap = new Map<string, number>();
  for (const group of subscriptionsByStatus) {
    subsByStatusMap.set(group.status.toLowerCase(), group._count._all);
  }
  const subsByStatus = Object.fromEntries(subsByStatusMap);

  // Daily subscription signups for the last 30 days
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const recentByDay = new Map<string, number>();
  for (const sub of recentSubscriptions) {
    if (sub.createdAt >= thirtyDaysAgo) {
      const key = sub.createdAt.toISOString().split('T')[0];
      recentByDay.set(key, (recentByDay.get(key) ?? 0) + 1);
    }
  }
  const dailySubscriptions: DataPoints = [];
  for (let i = 0; i <= 30; i++) {
    const day = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
    const key = day.toISOString().split('T')[0];
    dailySubscriptions.push({ date: key, activity: recentByDay.get(key) ?? 0 });
  }

  const estimatedMrrCents = activeSubscriptionCount * 10_000;
  const totalOrders = totalOneTimePurchases + totalSubscriptionInvoices;
  const checkoutConversionRate = totalOrders > 0
    ? Number((((successfulSubscriptionInvoices + totalOneTimePurchases) / totalOrders) * 100).toFixed(2))
    : 0;

  return {
    subscriptions_by_status: subsByStatus,
    active_subscription_count: activeSubscriptionCount,
    total_one_time_purchases: totalOneTimePurchases,
    daily_subscriptions: dailySubscriptions,
    revenue_cents: invoiceRevenue._sum.amountTotal ?? 0,
    mrr_cents: estimatedMrrCents,
    total_orders: totalOrders,
    checkout_conversion_rate: checkoutConversionRate,
  };
}

// ── Email Aggregates ─────────────────────────────────────────────────────────

async function loadEmailOverview(tenancy: Tenancy) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    statusGroups,
    recentEmails,
    deliveredCount,
    bouncedCount,
    clickedCount,
    finishedSendingCount,
    emailsByDayAndStatus,
  ] = await Promise.all([
    // group by simpleStatus
    (async () => {
      const prisma = await getPrismaClientForTenancy(tenancy);
      return await prisma.emailOutbox.groupBy({
        by: ['simpleStatus'],
        where: { tenancyId: tenancy.id },
        _count: { _all: true },
      });
    })(),
    (async () => {
      const prisma = await getPrismaClientForTenancy(tenancy);
      return await prisma.emailOutbox.findMany({
        where: { tenancyId: tenancy.id },
        orderBy: { createdAt: 'desc' },
        take: RECENT_LIST_PAGE_SIZE,
        select: { id: true, createdAt: true, simpleStatus: true, status: true, renderedSubject: true },
      });
    })(),
    (async () => {
      const prisma = await getPrismaClientForTenancy(tenancy);
      return await prisma.emailOutbox.count({ where: { tenancyId: tenancy.id, deliveredAt: { not: null } } });
    })(),
    (async () => {
      const prisma = await getPrismaClientForTenancy(tenancy);
      return await prisma.emailOutbox.count({ where: { tenancyId: tenancy.id, bouncedAt: { not: null } } });
    })(),
    (async () => {
      const prisma = await getPrismaClientForTenancy(tenancy);
      return await prisma.emailOutbox.count({ where: { tenancyId: tenancy.id, clickedAt: { not: null } } });
    })(),
    (async () => {
      const prisma = await getPrismaClientForTenancy(tenancy);
      return await prisma.emailOutbox.count({ where: { tenancyId: tenancy.id, finishedSendingAt: { not: null } } });
    })(),
    // Per-day per-simpleStatus counts for the last 30 days
    (async () => {
      const prisma = await getPrismaClientForTenancy(tenancy);
      return await prisma.emailOutbox.findMany({
        where: {
          tenancyId: tenancy.id,
          createdAt: { gte: thirtyDaysAgo },
        },
        select: { createdAt: true, simpleStatus: true },
      });
    })(),
  ]);

  const emailsByStatusMap = new Map<string, number>();
  for (const group of statusGroups) {
    emailsByStatusMap.set(group.simpleStatus.toLowerCase().replace('_', '-'), group._count._all);
  }
  const emailsByStatus = Object.fromEntries(emailsByStatusMap);

  // Daily email sends for last 30 days
  const emailByDay = new Map<string, number>();
  for (const email of emailsByDayAndStatus) {
    const key = email.createdAt.toISOString().split('T')[0];
    emailByDay.set(key, (emailByDay.get(key) ?? 0) + 1);
  }
  const dailyEmails: DataPoints = [];
  for (let i = 0; i <= 30; i++) {
    const day = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
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
  for (let i = 0; i <= 30; i++) {
    const key = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    dayStatusMap.set(key, { ok: 0, error: 0, in_progress: 0 });
  }
  for (const email of emailsByDayAndStatus) {
    const key = email.createdAt.toISOString().split('T')[0];
    const entry = dayStatusMap.get(key);
    if (entry != null) {
      const s = email.simpleStatus;
      if (s === 'OK') entry.ok += 1;
      else if (s === 'ERROR') entry.error += 1;
      else entry.in_progress += 1;
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

async function loadAnalyticsOverview(tenancy: Tenancy, now: Date, includeAnonymous: boolean) {
  const todayUtc = new Date(now);
  todayUtc.setUTCHours(0, 0, 0, 0);
  const since = new Date(todayUtc.getTime() - 30 * 24 * 60 * 60 * 1000);
  const untilExclusive = new Date(todayUtc.getTime() + 24 * 60 * 60 * 1000);

  const clickhouseClient = getClickhouseAdminClient();

  try {
    const [pageViewResult, dailyVisitorResult, totalVisitorResult, clickResult, referrerResult, topRegionResult, onlineResult, replayResult] = await Promise.all([
      clickhouseClient.query({
        query: `
          SELECT
            toDate(event_at) AS day,
            count() AS cnt
          FROM analytics_internal.events
          WHERE event_type = '$page-view'
            AND project_id = {projectId:String}
            AND branch_id = {branchId:String}
            AND event_at >= {since:DateTime}
            AND event_at < {untilExclusive:DateTime}
          GROUP BY day
          ORDER BY day ASC
        `,
        query_params: {
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
          since: formatClickhouseDateTimeParam(since),
          untilExclusive: formatClickhouseDateTimeParam(untilExclusive),
        },
        format: "JSONEachRow",
      }),
      clickhouseClient.query({
        query: `
          SELECT
            toDate(event_at) AS day,
            uniqExact(assumeNotNull(user_id)) AS cnt
          FROM analytics_internal.events
          WHERE event_type = '$page-view'
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
      }),
      clickhouseClient.query({
        query: `
          SELECT
            uniqExact(assumeNotNull(user_id)) AS visitors
          FROM analytics_internal.events
          WHERE event_type = '$page-view'
            AND project_id = {projectId:String}
            AND branch_id = {branchId:String}
            AND user_id IS NOT NULL
            AND event_at >= {since:DateTime}
            AND event_at < {untilExclusive:DateTime}
            AND ({includeAnonymous:UInt8} = 1 OR JSONExtract(toJSONString(data), 'is_anonymous', 'UInt8') = 0)
        `,
        query_params: {
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
          since: formatClickhouseDateTimeParam(since),
          untilExclusive: formatClickhouseDateTimeParam(untilExclusive),
          includeAnonymous: includeAnonymous ? 1 : 0,
        },
        format: "JSONEachRow",
      }),
      clickhouseClient.query({
        query: `
          SELECT
            toDate(event_at) AS day,
            count() AS cnt
          FROM analytics_internal.events
          WHERE event_type = '$click'
            AND project_id = {projectId:String}
            AND branch_id = {branchId:String}
            AND event_at >= {since:DateTime}
            AND event_at < {untilExclusive:DateTime}
          GROUP BY day
          ORDER BY day ASC
        `,
        query_params: {
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
          since: formatClickhouseDateTimeParam(since),
          untilExclusive: formatClickhouseDateTimeParam(untilExclusive),
        },
        format: "JSONEachRow",
      }),
      clickhouseClient.query({
        query: `
          SELECT
            nullIf(CAST(data.referrer, 'String'), '') AS referrer,
            count() AS cnt
          FROM analytics_internal.events
          WHERE event_type = '$page-view'
            AND project_id = {projectId:String}
            AND branch_id = {branchId:String}
            AND event_at >= {since:DateTime}
            AND event_at < {untilExclusive:DateTime}
          GROUP BY referrer
          ORDER BY cnt DESC
          LIMIT ${TOP_REFERRERS_PAGE_SIZE}
        `,
        query_params: {
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
          since: formatClickhouseDateTimeParam(since),
          untilExclusive: formatClickhouseDateTimeParam(untilExclusive),
        },
        format: "JSONEachRow",
      }),
      clickhouseClient.query({
        query: `
          SELECT
            CAST(data.ip_info.country_code, 'Nullable(String)') AS country_code,
            CAST(data.ip_info.region_code, 'Nullable(String)') AS region_code,
            count() AS cnt
          FROM analytics_internal.events
          WHERE event_type = '$token-refresh'
            AND project_id = {projectId:String}
            AND branch_id = {branchId:String}
            AND event_at >= {since:DateTime}
            AND event_at < {untilExclusive:DateTime}
          GROUP BY country_code, region_code
          ORDER BY cnt DESC
          LIMIT 1
        `,
        query_params: {
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
          since: formatClickhouseDateTimeParam(since),
          untilExclusive: formatClickhouseDateTimeParam(untilExclusive),
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
        `,
        query_params: {
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
          onlineSince: formatClickhouseDateTimeParam(new Date(now.getTime() - 5 * 60 * 1000)),
          untilExclusive: formatClickhouseDateTimeParam(untilExclusive),
        },
        format: "JSONEachRow",
      }),
      // session replay count from Postgres
      (async () => {
        const prisma = await getPrismaClientForTenancy(tenancy);
        const [total, recent, replayRows, revenue] = await Promise.all([
          prisma.sessionReplay.count({ where: { tenancyId: tenancy.id } }),
          prisma.sessionReplay.count({
            where: {
              tenancyId: tenancy.id,
              startedAt: { gte: since },
            },
          }),
          prisma.sessionReplay.findMany({
            where: {
              tenancyId: tenancy.id,
              startedAt: { gte: since },
            },
            select: {
              startedAt: true,
              lastEventAt: true,
            },
          }),
          prisma.subscriptionInvoice.aggregate({
            where: { tenancyId: tenancy.id, amountTotal: { not: null } },
            _sum: { amountTotal: true },
          }),
        ]);

        const avgSessionSeconds = replayRows.length > 0
          ? replayRows.reduce((sum, row) => sum + Math.max(0, row.lastEventAt.getTime() - row.startedAt.getTime()), 0) / replayRows.length / 1000
          : 0;
        return {
          total,
          recent,
          avgSessionSeconds: Number(avgSessionSeconds.toFixed(1)),
          totalRevenueCents: Number(revenue._sum.amountTotal ?? 0),
        };
      })(),
    ]);

    const pvRows: { day: string, cnt: number }[] = await pageViewResult.json();
    const clRows: { day: string, cnt: number }[] = await clickResult.json();

    const pvByDay = new Map<string, number>();
    for (const row of pvRows) {
      const key = new Date(row.day + 'Z').toISOString().split('T')[0];
      pvByDay.set(key, Number(row.cnt));
    }
    const clByDay = new Map<string, number>();
    for (const row of clRows) {
      const key = new Date(row.day + 'Z').toISOString().split('T')[0];
      clByDay.set(key, Number(row.cnt));
    }
    const visitorRows: { day: string, cnt: number }[] = await dailyVisitorResult.json();
    const visitorByDay = new Map<string, number>();
    for (const row of visitorRows) {
      const key = new Date(row.day + 'Z').toISOString().split('T')[0];
      visitorByDay.set(key, Number(row.cnt));
    }
    const totalVisitorRows: { visitors: number }[] = await totalVisitorResult.json();
    const visitors = Number(totalVisitorRows[0]?.visitors ?? 0);

    const dailyPageViews: DataPoints = [];
    const dailyClicks: DataPoints = [];
    const dailyVisitors: DataPoints = [];
    for (let i = 0; i <= 30; i++) {
      const day = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
      const key = day.toISOString().split('T')[0];
      dailyPageViews.push({ date: key, activity: pvByDay.get(key) ?? 0 });
      dailyClicks.push({ date: key, activity: clByDay.get(key) ?? 0 });
      dailyVisitors.push({ date: key, activity: visitorByDay.get(key) ?? 0 });
    }

    const referrers: { referrer: string | null, cnt: number }[] = await referrerResult.json();
    const topRegionRows: { country_code: string | null, region_code: string | null, cnt: number }[] = await topRegionResult.json();
    const onlineRows: { online: number }[] = await onlineResult.json();

    return {
      daily_page_views: dailyPageViews,
      daily_clicks: dailyClicks,
      daily_visitors: dailyVisitors,
      daily_revenue: dailyPageViews.map((p) => ({
        date: p.date,
        new_cents: 0,
        refund_cents: 0,
      })),
      total_revenue_cents: replayResult.totalRevenueCents,
      total_replays: replayResult.total,
      recent_replays: replayResult.recent,
      visitors,
      avg_session_seconds: replayResult.avgSessionSeconds,
      online_live: Number(onlineRows[0]?.online ?? 0),
      revenue_per_visitor: visitors > 0
        ? Number(((replayResult.totalRevenueCents / 100) / visitors).toFixed(2))
        : 0,
      top_referrers: referrers.map((row) => ({
        referrer: row.referrer ?? '(direct)',
        visitors: Number(row.cnt),
      })),
      top_region: topRegionRows[0] ? {
        country_code: topRegionRows[0].country_code,
        region_code: topRegionRows[0].region_code,
        count: Number(topRegionRows[0].cnt),
      } : null,
    };
  } catch (error) {
    captureError("internal-metrics-analytics-overview-fallback", new StackAssertionError(
      "Falling back to empty analytics overview due to query failure.",
      {
        cause: error,
        projectId: tenancy.project.id,
        branchId: tenancy.branchId,
      },
    ));
    // Analytics may not be enabled for all projects
    return {
      daily_page_views: [] as DataPoints,
      daily_clicks: [] as DataPoints,
      daily_visitors: [] as DataPoints,
      daily_revenue: [] as Array<{ date: string, new_cents: number, refund_cents: number }>,
      total_revenue_cents: 0,
      total_replays: 0,
      recent_replays: 0,
      visitors: 0,
      avg_session_seconds: 0,
      online_live: 0,
      revenue_per_visitor: 0,
      top_referrers: [],
      top_region: null,
    };
  }
}

// ── Development-mode fallback data for ClickHouse-dependent metrics ──────────
// In development, ClickHouse often has no event data (no $token-refresh,
// $page-view, etc.), so charts appear empty. These functions generate
// realistic-looking synthetic data so the dashboard is usable in dev.

function seededPrng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function generateDevDauSplit(now: Date, totalUsers: number): ActivitySplit {
  if (getNodeEnvironment() === 'production') {
    return createEmptySplitSeries([]);
  }

  const rand = seededPrng(12345);
  const todayUtc = new Date(now);
  todayUtc.setUTCHours(0, 0, 0, 0);
  const since = new Date(todayUtc.getTime() - 30 * 24 * 60 * 60 * 1000);
  const days: string[] = [];
  for (let i = 0; i <= 30; i++) {
    days.push(new Date(since.getTime() + i * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  }

  const base = Math.max(2, Math.floor(totalUsers * 0.15));
  const split = createEmptySplitSeries(days);

  for (let i = 0; i < days.length; i++) {
    const dayOfWeek = new Date(days[i]).getDay();
    const weekendFactor = (dayOfWeek === 0 || dayOfWeek === 6) ? 0.6 : 1.0;
    const trendFactor = 0.7 + (i / days.length) * 0.6;
    const noise = 0.7 + rand() * 0.6;

    const total = Math.max(1, Math.round(base * weekendFactor * trendFactor * noise));
    const newPct = 0.15 + rand() * 0.2;
    const reactivatedPct = 0.05 + rand() * 0.15;
    const retainedPct = 1 - newPct - reactivatedPct;

    split.new[i].activity = Math.max(0, Math.round(total * newPct));
    split.reactivated[i].activity = Math.max(0, Math.round(total * reactivatedPct));
    split.retained[i].activity = Math.max(0, Math.round(total * retainedPct));
    split.total[i].activity = split.new[i].activity + split.reactivated[i].activity + split.retained[i].activity;
  }

  return split;
}

function generateDevAnalyticsOverview(now: Date, totalUsers: number) {
  if (getNodeEnvironment() === 'production') return null;

  const rand = seededPrng(67890);
  const todayUtc = new Date(now);
  todayUtc.setUTCHours(0, 0, 0, 0);
  const since = new Date(todayUtc.getTime() - 30 * 24 * 60 * 60 * 1000);

  const dailyPageViews: DataPoints = [];
  const dailyClicks: DataPoints = [];
  const dailyRevenue: Array<{ date: string, new_cents: number, refund_cents: number }> = [];
  const dailyVisitors: DataPoints = [];
  for (let i = 0; i <= 30; i++) {
    const day = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    const key = day.toISOString().split('T')[0];
    const dayOfWeek = day.getDay();
    const weekendFactor = (dayOfWeek === 0 || dayOfWeek === 6) ? 0.55 : 1.0;
    const trendFactor = 0.8 + (i / 30) * 0.4;
    const pvNoise = 0.6 + rand() * 0.8;
    const clNoise = 0.5 + rand() * 1.0;

    const pv = Math.max(3, Math.round(totalUsers * 2.5 * weekendFactor * trendFactor * pvNoise));
    const cl = Math.max(1, Math.round(pv * 0.3 * clNoise));
    dailyPageViews.push({ date: key, activity: pv });
    dailyClicks.push({ date: key, activity: cl });

    const baseRevenue = Math.round(300 + totalUsers * 8 * weekendFactor * trendFactor * (0.7 + rand() * 0.6));
    const refundRate = 0.15 + rand() * 0.25;
    const refundCents = Math.round(baseRevenue * refundRate);
    dailyRevenue.push({ date: key, new_cents: baseRevenue, refund_cents: refundCents });

    const vis = Math.max(5, Math.round(pv * (0.4 + rand() * 0.2)));
    dailyVisitors.push({ date: key, activity: vis });
  }

  const visitors = Math.max(totalUsers, Math.round(totalUsers * 1.8 + rand() * totalUsers * 0.5));
  const avgSessionSeconds = 180 + Math.round(rand() * 440);
  const onlineLive = Math.max(1, Math.round(totalUsers * 0.05 + rand() * 3));
  const totalRevenueCents = dailyRevenue.reduce((sum, d) => sum + d.new_cents, 0);
  const revenuePerVisitor = visitors > 0 ? Number(((totalRevenueCents / 100) / visitors).toFixed(2)) : 0;
  const bounceRate = Number((55 + rand() * 30).toFixed(1));
  const conversionRate = Number((0.2 + rand() * 0.8).toFixed(2));

  return {
    daily_page_views: dailyPageViews,
    daily_clicks: dailyClicks,
    daily_revenue: dailyRevenue,
    daily_visitors: dailyVisitors,
    total_replays: Math.round(visitors * 0.3),
    recent_replays: Math.round(visitors * 0.1),
    visitors,
    total_revenue_cents: totalRevenueCents,
    avg_session_seconds: avgSessionSeconds,
    online_live: onlineLive,
    revenue_per_visitor: revenuePerVisitor,
    bounce_rate: bounceRate,
    conversion_rate: conversionRate,
    deltas: {
      visitors: Number((-15 + rand() * 30).toFixed(1)),
      revenue: Number((-25 + rand() * 50).toFixed(1)),
      conversion_rate: Number((-20 + rand() * 40).toFixed(1)),
      revenue_per_visitor: Number((-20 + rand() * 40).toFixed(1)),
      bounce_rate: Number((-10 + rand() * 20).toFixed(1)),
      session_time: Number((-15 + rand() * 30).toFixed(1)),
    },
    top_referrers: [
      { referrer: 'google.com', visitors: Math.round(visitors * 0.32 + rand() * 10) },
      { referrer: 'github.com', visitors: Math.round(visitors * 0.18 + rand() * 8) },
      { referrer: 'twitter.com', visitors: Math.round(visitors * 0.12 + rand() * 5) },
      { referrer: 'producthunt.com', visitors: Math.round(visitors * 0.08 + rand() * 4) },
      { referrer: '(direct)', visitors: Math.round(visitors * 0.06 + rand() * 3) },
    ],
    top_region: {
      country_code: 'US',
      region_code: 'CA',
      count: Math.round(visitors * 0.25),
    },
  };
}

// ── Auth Extra Aggregates ────────────────────────────────────────────────────

async function loadAuthOverview(tenancy: Tenancy, includeAnonymous: boolean, now: Date) {
  const prisma = await getPrismaClientForTenancy(tenancy);

  const [totalUsers, verifiedUsers, verifiedNonAnonymousUsers, anonymousUsers, totalTeams] = await Promise.all([
    prisma.projectUser.count({ where: { tenancyId: tenancy.id } }),
    prisma.projectUser.count({
      where: {
        tenancyId: tenancy.id,
        contactChannels: { some: { type: 'EMAIL', isVerified: true } },
      },
    }),
    prisma.projectUser.count({
      where: {
        tenancyId: tenancy.id,
        isAnonymous: false,
        contactChannels: { some: { type: 'EMAIL', isVerified: true } },
      },
    }),
    prisma.projectUser.count({ where: { tenancyId: tenancy.id, isAnonymous: true } }),
    prisma.team.count({ where: { tenancyId: tenancy.id } }),
  ]);

  const nonAnonymousTotal = totalUsers - anonymousUsers;

  const [dailyActiveUsersSplit, dailyActiveTeamsSplit, mau] = await Promise.all([
    loadDailyActiveUsersSplit(tenancy, now, includeAnonymous),
    loadDailyActiveTeamsSplit(tenancy, now),
    loadMonthlyActiveUsers(tenancy, includeAnonymous),
  ]);

  return {
    verified_users: includeAnonymous ? verifiedUsers : verifiedNonAnonymousUsers,
    unverified_users: nonAnonymousTotal - verifiedNonAnonymousUsers,
    anonymous_users: anonymousUsers,
    total_teams: totalTeams,
    mau,
    daily_active_users_split: dailyActiveUsersSplit,
    daily_active_teams_split: dailyActiveTeamsSplit,
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
      // TODO: Narrow down the types further
      users_by_country: yupMixed().defined(),
      recently_registered: yupMixed().defined(),
      recently_active: yupMixed().defined(),
      login_methods: yupMixed().defined(),
      // Extended cross-product aggregates
      auth_overview: yupMixed().defined(),
      payments_overview: yupMixed().defined(),
      email_overview: yupMixed().defined(),
      analytics_overview: yupMixed().defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const now = new Date();
    const includeAnonymous = req.query.include_anonymous === "true";

    const prisma = await getPrismaClientForTenancy(req.auth.tenancy);

    const [
      totalUsers,
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
    ] = await Promise.all([
      prisma.projectUser.count({
        where: { tenancyId: req.auth.tenancy.id, ...(includeAnonymous ? {} : { isAnonymous: false }) },
      }),
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
      loadPaymentsOverview(req.auth.tenancy),
      loadEmailOverview(req.auth.tenancy),
      loadAnalyticsOverview(req.auth.tenancy, now, includeAnonymous),
    ] as const);

    // In dev, ClickHouse may have no events — fill in realistic fallback data
    const dauSplitIsEmpty = authOverview.daily_active_users_split.total.every(
      (d: { activity: number }) => d.activity === 0
    );
    const finalAuthOverview = dauSplitIsEmpty && getNodeEnvironment() !== 'production'
      ? {
        ...authOverview,
        daily_active_users_split: generateDevDauSplit(now, totalUsers),
        // Fallback MAU is ~30% of total users in dev
        mau: authOverview.mau === 0 ? Math.max(1, Math.round(totalUsers * 0.3)) : authOverview.mau,
      }
      : authOverview;

    const referrersEmpty = (analyticsOverview.top_referrers as { referrer: string, visitors: number }[]).length === 0;
    const finalAnalyticsOverview = referrersEmpty && getNodeEnvironment() !== 'production'
      ? (generateDevAnalyticsOverview(now, totalUsers) ?? analyticsOverview)
      : analyticsOverview;

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
        auth_overview: finalAuthOverview,
        payments_overview: paymentsOverview,
        email_overview: emailOverview,
        analytics_overview: finalAnalyticsOverview,
      }
    };
  },
});
