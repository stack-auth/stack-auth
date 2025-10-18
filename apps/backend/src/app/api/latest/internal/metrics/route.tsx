import { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, globalPrismaClient, sqlQuoteIdent } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { traceSpan } from "@stackframe/stack-shared/dist/utils/telemetry";
import yup from 'yup';
import { usersCrudHandlers } from "../../users/crud";

type DataPoints = yup.InferType<typeof DataPointsSchema>;

const DataPointsSchema = yupArray(yupObject({
  date: yupString().defined(),
  activity: yupNumber().defined(),
}).defined()).defined();

function withDurationLogging<T extends (...args: any[]) => Promise<any>>(label: string, fn: T): T {
  return (async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
    return await traceSpan({
      description: `metrics.${label}`,
      attributes: {
        "metrics.name": label,
      },
    }, async (span) => {
      const start = performance.now();
      try {
        return await fn(...args);
      } finally {
        const durationMs = performance.now() - start;
        span.setAttribute("metrics.duration_ms", durationMs);
        console.log(`[metrics] ${label} took ${durationMs.toFixed(2)}ms`);
      }
    });
  }) as T;
}

const loadUsersByCountry = withDurationLogging(
  "loadUsersByCountry",
  async (tenancy: Tenancy, includeAnonymous: boolean = false): Promise<Record<string, number>> => {
    const a = await globalPrismaClient.$queryRaw<{ countryCode: string | null, userCount: bigint }[]>`
      WITH filtered_events AS (
        SELECT
          "Event"."eventStartedAt",
          "Event"."data"->>'userId' AS "userId",
          eip."countryCode"
        FROM "Event"
        JOIN "EventIpInfo" eip
          ON "Event"."endUserIpInfoGuessId" = eip.id
        WHERE '$user-activity' = ANY("Event"."systemEventTypeIds"::text[])
          AND "Event"."data" @> jsonb_build_object('projectId', ${tenancy.project.id})
          AND (
            ${includeAnonymous}
            OR NOT (
              "Event"."data" @> jsonb_build_object('isAnonymous', true)
              OR "Event"."data" @> jsonb_build_object('isAnonymous', 'true')
            )
          )
          AND (
            "Event"."data" @> jsonb_build_object('branchId', ${tenancy.branchId})
            OR (${tenancy.branchId} = 'main' AND NOT ("Event"."data" ? 'branchId'))
          )
          AND eip."countryCode" IS NOT NULL
      ),
      LatestEventWithCountryCode AS (
        SELECT DISTINCT ON (fe."userId")
          fe."userId",
          fe."countryCode"
        FROM filtered_events fe
        ORDER BY fe."userId", fe."eventStartedAt" DESC
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
);

const loadTotalUsers = withDurationLogging(
  "loadTotalUsers",
  async (tenancy: Tenancy, now: Date, includeAnonymous: boolean = false): Promise<DataPoints> => {
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
);

const loadDailyActiveUsers = withDurationLogging(
  "loadDailyActiveUsers",
  async (tenancy: Tenancy, now: Date, includeAnonymous: boolean = false) => {
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
          DATE_TRUNC('day', "Event"."eventStartedAt") AS "day",
          "Event"."data"->>'userId' AS "userId"
        FROM "Event"
        WHERE "Event"."eventStartedAt" >= ${now}::date - INTERVAL '30 days'
          AND '$user-activity' = ANY("Event"."systemEventTypeIds"::text[])
          AND "Event"."data" @> jsonb_build_object('projectId', ${tenancy.project.id})
          AND (
            ${includeAnonymous}
            OR NOT (
              "Event"."data" @> jsonb_build_object('isAnonymous', true)
              OR "Event"."data" @> jsonb_build_object('isAnonymous', 'true')
            )
          )
          AND (
            "Event"."data" @> jsonb_build_object('branchId', ${tenancy.branchId})
            OR (${tenancy.branchId} = 'main' AND NOT ("Event"."data" ? 'branchId'))
          )
      ),
      daily_users AS (
        SELECT
          fe."day",
          COUNT(DISTINCT fe."userId") AS "dau"
        FROM filtered_events fe
        WHERE fe."userId" IS NOT NULL
        GROUP BY fe."day"
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
);

const loadLoginMethods = withDurationLogging(
  "loadLoginMethods",
  async (tenancy: Tenancy): Promise<{ method: string, count: number }[]> => {
    const schema = await getPrismaSchemaForTenancy(tenancy);
    const prisma = await getPrismaClientForTenancy(tenancy);
    return prisma.$queryRaw<{ method: string, count: number }[]>`
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
);

const loadRecentlyActiveUsers = withDurationLogging(
  "loadRecentlyActiveUsers",
  async (tenancy: Tenancy, includeAnonymous: boolean = false): Promise<UsersCrud["Admin"]["Read"][]> => {
    // use the Events table to get the most recent activity
    const events = await globalPrismaClient.$queryRaw<{ data: any, userId: string | null, eventStartedAt: Date }[]>`
      WITH filtered_events AS (
        SELECT
          "Event"."data",
          "Event"."data"->>'userId' AS "userId",
          "Event"."eventStartedAt"
        FROM "Event"
        WHERE "Event"."data" @> jsonb_build_object('projectId', ${tenancy.project.id})
          AND (
            ${includeAnonymous}
            OR NOT (
              "Event"."data" @> jsonb_build_object('isAnonymous', true)
              OR "Event"."data" @> jsonb_build_object('isAnonymous', 'true')
            )
          )
          AND (
            "Event"."data" @> jsonb_build_object('branchId', ${tenancy.branchId})
            OR (${tenancy.branchId} = 'main' AND NOT ("Event"."data" ? 'branchId'))
          )
          AND '$user-activity' = ANY("Event"."systemEventTypeIds"::text[])
      ),
      latest_events AS (
        SELECT DISTINCT ON (fe."userId")
          fe."data",
          fe."userId",
          fe."eventStartedAt"
        FROM filtered_events fe
        WHERE fe."userId" IS NOT NULL
        ORDER BY fe."userId", fe."eventStartedAt" DESC
      )
      SELECT "data", "userId", "eventStartedAt"
      FROM latest_events
      ORDER BY "eventStartedAt" DESC
      LIMIT 5
    `;
    const users = await Promise.all(events.map(async (event) => {
      if (!event.userId) {
        return null;
      }
      try {
        return await usersCrudHandlers.adminRead({
          tenancy,
          user_id: event.userId,
          allowedErrorTypes: [
            KnownErrors.UserNotFound,
          ],
        });
      } catch (e) {
        if (KnownErrors.UserNotFound.isInstance(e)) {
          // user probably deleted their account, skip
          return null;
        }
        throw e;
      }
    }));
    return users.filter((user): user is UsersCrud["Admin"]["Read"] => Boolean(user));
  }
);

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
