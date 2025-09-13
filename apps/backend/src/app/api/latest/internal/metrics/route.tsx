import { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, globalPrismaClient, sqlQuoteIdent } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import yup from 'yup';
import { usersCrudHandlers } from "../../users/crud";

type DataPoints = yup.InferType<typeof DataPointsSchema>;

const DataPointsSchema = yupArray(yupObject({
  date: yupString().defined(),
  activity: yupNumber().defined(),
}).defined()).defined();


async function loadUsersByCountry(tenancy: Tenancy, includeAnonymous: boolean = false): Promise<Record<string, number>> {
  const a = await globalPrismaClient.$queryRaw<{countryCode: string|null, userCount: bigint}[]>`
    WITH LatestEventWithCountryCode AS (
      SELECT DISTINCT ON ("userId")
        "data"->'userId' AS "userId",
        "countryCode",
        "eventStartedAt" AS latest_timestamp
      FROM "Event"
      LEFT JOIN "EventIpInfo" eip
        ON "Event"."endUserIpInfoGuessId" = eip.id
      WHERE '$user-activity' = ANY("systemEventTypeIds"::text[])
        AND "data"->>'projectId' = ${tenancy.project.id}
        AND (${includeAnonymous} OR COALESCE("data"->>'isAnonymous', 'false') != 'true')
        AND COALESCE("data"->>'branchId', 'main') = ${tenancy.branchId}
        AND "countryCode" IS NOT NULL
      ORDER BY "userId", "eventStartedAt" DESC
    )
    SELECT "countryCode", COUNT("userId") AS "userCount"
    FROM LatestEventWithCountryCode
    GROUP BY "countryCode"
    ORDER BY "userCount" DESC;
  `;

  const rec = Object.fromEntries(
    a.map(({ userCount, countryCode }) => [countryCode, Number(userCount)])
      .filter(([countryCode, userCount]) => countryCode)
  );
  return rec;
}

async function loadTotalUsers(tenancy: Tenancy, now: Date, includeAnonymous: boolean = false): Promise<DataPoints> {
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);
  return (await prisma.$queryRaw<{date: Date, dailyUsers: bigint, cumUsers: bigint}[]>`
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
  const res = await globalPrismaClient.$queryRaw<{day: Date, dau: bigint}[]>`
    WITH date_series AS (
      SELECT GENERATE_SERIES(
        ${now}::date - INTERVAL '30 days',
        ${now}::date,
        '1 day'
      )
      AS "day"
    ),
    daily_users AS (
      SELECT
        DATE_TRUNC('day', "eventStartedAt") AS "day",
        COUNT(DISTINCT CASE WHEN (${includeAnonymous} OR COALESCE("data"->>'isAnonymous', 'false') != 'true') THEN "data"->'userId' ELSE NULL END) AS "dau"
      FROM "Event"
      WHERE "eventStartedAt" >= ${now}::date - INTERVAL '30 days'
        AND '$user-activity' = ANY("systemEventTypeIds"::text[])
        AND "data"->>'projectId' = ${tenancy.project.id}
        AND COALESCE("data"->>'branchId', 'main') = ${tenancy.branchId}
      GROUP BY DATE_TRUNC('day', "eventStartedAt")
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
  }));
}

async function loadLoginMethods(tenancy: Tenancy): Promise<{method: string, count: number }[]> {
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
  // use the Events table to get the most recent activity
  const events = await globalPrismaClient.$queryRaw<{ data: any, eventStartedAt: Date }[]>`
    WITH RankedEvents AS (
      SELECT 
        "data", "eventStartedAt",
        ROW_NUMBER() OVER (
          PARTITION BY "data"->>'userId' 
          ORDER BY "eventStartedAt" DESC
        ) as rn
      FROM "Event"
      WHERE "data"->>'projectId' = ${tenancy.project.id}
        AND (${includeAnonymous} OR COALESCE("data"->>'isAnonymous', 'false') != 'true')
        AND COALESCE("data"->>'branchId', 'main') = ${tenancy.branchId}
        AND '$user-activity' = ANY("systemEventTypeIds"::text[])
    )
    SELECT "data", "eventStartedAt"
    FROM RankedEvents
    WHERE rn = 1
    ORDER BY "eventStartedAt" DESC
    LIMIT 5
  `;
  const userObjects: UsersCrud["Admin"]["Read"][] = [];
  for (const event of events) {
    let user;
    try {
      user = await usersCrudHandlers.adminRead({
        tenancy,
        user_id: event.data.userId,
        allowedErrorTypes: [
          KnownErrors.UserNotFound,
        ],
      });
    } catch (e) {
      if (KnownErrors.UserNotFound.isInstance(e)) {
        // user probably deleted their account, skip
        continue;
      }
      throw e;
    }
    userObjects.push(user);
  }
  return userObjects;
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
      loadUsersByCountry(req.auth.tenancy, includeAnonymous),
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

