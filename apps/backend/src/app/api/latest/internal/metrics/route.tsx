import { Tenancy } from "@/lib/tenancies";
import { getOrSetCacheValue } from "@/lib/cache";
import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, globalPrismaClient, PrismaClientTransaction, sqlQuoteIdent } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import yup from 'yup';
import { userFullInclude, userPrismaToCrud } from "../../users/crud";
import { usersCrudHandlers } from "../../users/crud";
import { Prisma } from "@prisma/client";

type DataPoints = yup.InferType<typeof DataPointsSchema>;

const METRICS_CACHE_NAMESPACE = "metrics";
const ONE_HOUR_MS = 60 * 60 * 1000;

async function withMetricsCache<T>(tenancy: Tenancy, suffix: string, prisma: PrismaClientTransaction, includeAnonymous: boolean = false, loader: () => Promise<T>): Promise<T> {
  return await getOrSetCacheValue<T>({
    namespace: METRICS_CACHE_NAMESPACE,
    cacheKey: `${tenancy.id}:${suffix}:${includeAnonymous ? "anon" : "non_anon"}`,
    ttlMs: ONE_HOUR_MS,
    prisma,
    loader,
  });
}

const DataPointsSchema = yupArray(yupObject({
  date: yupString().defined(),
  activity: yupNumber().defined(),
}).defined()).defined();


async function loadUsersByCountry(tenancy: Tenancy, prisma: PrismaClientTransaction, includeAnonymous: boolean = false): Promise<Record<string, number>> {
  const users = await prisma.projectUser.findMany({
    where: {
      tenancyId: tenancy.id,
      ...(includeAnonymous ? {} : { isAnonymous: false }),
    },
    select: { projectUserId: true },
  });

  if (users.length === 0) {
    return {};
  }

  const userIds = users.map((user) => user.projectUserId);
  const userIdArray = Prisma.sql`ARRAY[${Prisma.join(userIds.map((id) => Prisma.sql`${id}`))}]::text[]`;

  const rows = await globalPrismaClient.$queryRaw<{ countryCode: string | null, userCount: bigint }[]>(Prisma.sql`
    WITH latest_ip AS (
      SELECT DISTINCT ON (e."data"->>'userId')
        e."data"->>'userId' AS "userId",
        eip."countryCode" AS "countryCode"
      FROM "Event" e
      JOIN "EventIpInfo" eip
        ON eip.id = e."endUserIpInfoGuessId"
      WHERE '$user-activity' = ANY(e."systemEventTypeIds"::text[])
        AND e."data"->>'projectId' = ${tenancy.project.id}
        AND COALESCE(e."data"->>'branchId', 'main') = ${tenancy.branchId}
        AND e."data"->>'userId' = ANY(${userIdArray})
        AND e."endUserIpInfoGuessId" IS NOT NULL
        AND eip."countryCode" IS NOT NULL
      ORDER BY e."data"->>'userId', e."eventStartedAt" DESC
    )
    SELECT "countryCode", COUNT("userId") AS "userCount"
    FROM latest_ip
    GROUP BY "countryCode"
    ORDER BY "userCount" DESC;
  `);

  return Object.fromEntries(
    rows.map(({ userCount, countryCode }) => [countryCode, Number(userCount)])
      .filter(([countryCode]) => countryCode)
  );
}

async function loadTotalUsers(tenancy: Tenancy, now: Date, includeAnonymous: boolean = false): Promise<DataPoints> {
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);
  return (await prisma.$queryRaw<{ date: Date, dailyUsers: bigint, cumUsers: bigint }[]>`
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
  const res = await globalPrismaClient.$queryRaw<{ day: Date, dau: bigint }[]>`
    WITH date_series AS (
      SELECT GENERATE_SERIES(
        ${now}::date - INTERVAL '30 days',
        ${now}::date,
        '1 day'
      )
      AS "day"
    ),
    filtered_events AS (
      SELECT
        ("eventStartedAt"::date) AS "day",
        "data"->>'userId' AS "userId"
      FROM "Event"
      WHERE "eventStartedAt" >= ${now}::date - INTERVAL '30 days'
        AND "eventStartedAt" < ${now}::date + INTERVAL '1 day'
        AND '$user-activity' = ANY("systemEventTypeIds"::text[])
        AND "data"->>'projectId' = ${tenancy.project.id}
        AND COALESCE("data"->>'branchId', 'main') = ${tenancy.branchId}
        AND (${includeAnonymous} OR COALESCE("data"->>'isAnonymous', 'false') != 'true')
        AND "data"->>'userId' IS NOT NULL
    ),
    unique_daily_users AS (
      SELECT "day", "userId"
      FROM filtered_events
      GROUP BY "day", "userId"
    ),
    daily_users AS (
      SELECT "day", COUNT(*) AS "dau"
      FROM unique_daily_users
      GROUP BY "day"
    )
    SELECT ds."day", COALESCE(du.dau, 0) AS dau
    FROM date_series ds
    LEFT JOIN daily_users du 
    ON ds."day" = du."day"
    ORDER BY ds."day"
  `;

  return res.map(x => ({
    date: x.day.toISOString().split('T')[0],
    activity: Number(x.dau),
  })) as DataPoints;
}

async function loadLoginMethods(tenancy: Tenancy): Promise<{ method: string, count: number }[]> {
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);
  return await prisma.$queryRaw<{ method: string, count: number }[]>`
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
  const events = await globalPrismaClient.$queryRaw<{ userId: string, lastActiveAt: Date }[]>`
    WITH ordered_events AS (
      SELECT
        "data"->>'userId' AS "userId",
        "eventStartedAt" AS "lastActiveAt"
      FROM "Event"
      WHERE "data"->>'projectId' = ${tenancy.project.id}
        AND COALESCE("data"->>'branchId', 'main') = ${tenancy.branchId}
        AND (${includeAnonymous} OR COALESCE("data"->>'isAnonymous', 'false') != 'true')
        AND '$user-activity' = ANY("systemEventTypeIds"::text[])
        AND "data"->>'userId' IS NOT NULL
      ORDER BY "eventStartedAt" DESC
      LIMIT 4000
    ),
    latest_events AS (
      SELECT DISTINCT ON ("userId")
        "userId",
        "lastActiveAt"
      FROM ordered_events
      ORDER BY "userId", "lastActiveAt" DESC
    )
    SELECT "userId", "lastActiveAt"
    FROM latest_events
    ORDER BY "lastActiveAt" DESC
    LIMIT 5
  `;
  if (events.length === 0) {
    return [];
  }

  const prisma = await getPrismaClientForTenancy(tenancy);
  const dbUsers = await prisma.projectUser.findMany({
    where: {
      tenancyId: tenancy.id,
      projectUserId: {
        in: events.map((event) => event.userId),
      },
    },
    include: userFullInclude,
  });

  const userObjects = events.map((event) => {
    const user = dbUsers.find((user) => user.projectUserId === event.userId);
    return user ? userPrismaToCrud(user, event.lastActiveAt.getTime()) : null;
  });
  return userObjects.filter((user): user is UsersCrud["Admin"]["Read"] => user !== null);
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
      withMetricsCache(
        req.auth.tenancy,
        "daily_active_users",
        prisma,
        includeAnonymous,
        () => loadDailyActiveUsers(req.auth.tenancy, now, includeAnonymous)
      ),
      withMetricsCache(
        req.auth.tenancy,
        "users_by_country",
        prisma,
        includeAnonymous,
        () => loadUsersByCountry(req.auth.tenancy, prisma, includeAnonymous)
      ),
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
