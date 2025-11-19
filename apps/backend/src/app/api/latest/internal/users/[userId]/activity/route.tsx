import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

const ActivityDataSchema = yupArray(yupObject({
  date: yupString().defined(),
  count: yupNumber().defined(),
}).defined()).defined();

// GET /api/latest/internal/users/[userId]/activity
export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get user activity",
    description: "Fetch daily activity data for a specific user over the past year",
    tags: ["Internal"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      userId: yupString().defined(),
    }).defined(),
    query: yupObject({}),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      activity: ActivityDataSchema,
    }).defined(),
  }),
  handler: async ({ auth, params }) => {
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(now.getFullYear() - 1);

    // Query daily activity for the user
    const activity = await globalPrismaClient.$queryRaw<{ date: Date, count: bigint }[]>`
      WITH date_series AS (
        SELECT GENERATE_SERIES(
          ${oneYearAgo}::date,
          ${now}::date,
          '1 day'
        )
        AS "day"
      ),
      daily_activity AS (
        SELECT
          ("eventStartedAt"::date) AS "day",
          COUNT(*) AS "count"
        FROM "Event"
        WHERE "eventStartedAt" >= ${oneYearAgo}::date
          AND "eventStartedAt" < ${now}::date + INTERVAL '1 day'
          AND '$user-activity' = ANY("systemEventTypeIds"::text[])
          AND "data"->>'projectId' = ${auth.tenancy.project.id}
          AND COALESCE("data"->>'branchId', 'main') = ${auth.tenancy.branchId}
          AND "data"->>'userId' = ${params.userId}
        GROUP BY "day"
      )
      SELECT 
        ds."day" AS "date",
        COALESCE(da."count", 0) AS "count"
      FROM date_series ds
      LEFT JOIN daily_activity da 
      ON ds."day" = da."day"
      ORDER BY ds."day"
    `;

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        activity: activity.map(row => ({
          date: row.date.toISOString().split('T')[0],
          count: Number(row.count),
        })),
      },
    };
  },
});

