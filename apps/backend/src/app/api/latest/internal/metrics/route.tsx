import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, PrismaClientTransaction, getPrismaSchemaForTenancy, sqlQuoteIdent } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
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

async function loadUsersByCountry(tenancy: Tenancy, prisma: PrismaClientTransaction, includeAnonymous: boolean = false): Promise<Record<string, number>> {
  const totalUsers = await prisma.projectUser.count({
    where: {
      tenancyId: tenancy.id,
      ...(includeAnonymous ? {} : { isAnonymous: false }),
    },
  });
  const users = await prisma.projectUser.findMany({
    where: {
      tenancyId: tenancy.id,
      ...(includeAnonymous ? {} : { isAnonymous: false }),
    },
    select: { projectUserId: true },
    orderBy: { projectUserId: "asc" },
    take: Math.min(totalUsers, MAX_USERS_FOR_COUNTRY_SAMPLE),
  });

  if (users.length === 0) {
    return {};
  }

  const userIds = users.map((user) => user.projectUserId);
  const scalingFactor = totalUsers > users.length ? totalUsers / users.length : 1;

  // Build ClickHouse array literal inline in the query body (sent via POST) instead of
  // passing as query_params (sent as URL params) to avoid the HTTP form field size limit
  // when there are many user IDs. UUIDs contain only hex chars and dashes, but we escape
  // single quotes for safety.
  const userIdsArrayLiteral = `[${userIds.map(id => `'${id.replace(/'/g, "''")}'`).join(',')}]`;

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
            AND has(${userIdsArrayLiteral}, assumeNotNull(user_id))
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
      const estimatedCount = scalingFactor === 1 ? count : Math.round(count * scalingFactor);
      return [country_code, estimatedCount] as [string, number];
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
      loginMethods
    ] = await Promise.all([
      prisma.projectUser.count({
        where: { tenancyId: req.auth.tenancy.id, ...(includeAnonymous ? {} : { isAnonymous: false }) },
      }),
      loadTotalUsers(req.auth.tenancy, now, includeAnonymous),
      loadDailyActiveUsers(req.auth.tenancy, now, includeAnonymous),
      loadUsersByCountry(req.auth.tenancy, prisma, includeAnonymous),
      usersCrudHandlers.adminList({
        tenancy: req.auth.tenancy,
        query: {
          order_by: 'signed_up_at',
          desc: "true",
          limit: 5,
          include_anonymous: includeAnonymous ? "true" : "false",
        },
        allowedErrorTypes: [
          KnownErrors.UserNotFound,
        ],
      }).then(res => res.items),
      loadRecentlyActiveUsers(req.auth.tenancy, includeAnonymous),
      loadLoginMethods(req.auth.tenancy),
    ] as const);

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
      }
    };
  },
});
