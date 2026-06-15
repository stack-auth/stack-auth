import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { ClickHouseError } from "@clickhouse/client";
import { UserActivityResponseBodySchema } from "@hexclave/shared/dist/interface/admin-metrics";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { HexclaveAssertionError, StatusError, captureError } from "@hexclave/shared/dist/utils/errors";

// Per-user activity clickmap window. Sized to match the 22×16 dashboard grid
// so every cell maps to exactly one day and we never truncate or pad awkwardly
// on the client. Bump both sides if you want a longer/shorter window.
const USER_ACTIVITY_WINDOW_DAYS = 22 * 16;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function formatClickhouseDateTimeParam(date: Date): string {
  // ClickHouse DateTime params are passed as "YYYY-MM-DDTHH:MM:SS" (no timezone); treat them as UTC.
  return date.toISOString().slice(0, 19);
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
      user_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: UserActivityResponseBodySchema,
  }),
  handler: async (req) => {
    const { tenancy } = req.auth;
    const userId = req.query.user_id;

    const now = new Date();
    const todayUtc = new Date(now);
    todayUtc.setUTCHours(0, 0, 0, 0);
    const untilExclusive = new Date(todayUtc.getTime() + ONE_DAY_MS);
    const since = new Date(todayUtc.getTime() - (USER_ACTIVITY_WINDOW_DAYS - 1) * ONE_DAY_MS);

    let rows: { day: string, activity: string | number }[];
    try {
      const clickhouseClient = getClickhouseAdminClient();
      const result = await clickhouseClient.query({
        query: `
          SELECT
            toDate(event_at) AS day,
            count() AS activity
          FROM analytics_internal.events
          WHERE project_id = {projectId:String}
            AND branch_id = {branchId:String}
            AND user_id = {userId:String}
            AND event_at >= {since:DateTime}
            AND event_at < {untilExclusive:DateTime}
          GROUP BY day
          ORDER BY day ASC
        `,
        query_params: {
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
          userId,
          since: formatClickhouseDateTimeParam(since),
          untilExclusive: formatClickhouseDateTimeParam(untilExclusive),
        },
        format: "JSONEachRow",
      });
      rows = await result.json();
    } catch (error) {
      if (!(error instanceof ClickHouseError)) {
        throw error;
      }
      captureError("internal-user-activity-clickhouse-fallback", new HexclaveAssertionError(
        "Failed to load user activity due to ClickHouse query failure.",
        {
          cause: error,
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
          userId,
        },
      ));
      throw new StatusError(StatusError.ServiceUnavailable, "Analytics activity is temporarily unavailable.");
    }

    const byDay = new Map<string, number>();
    for (const row of rows) {
      // ClickHouse returns dates/datetimes without timezone, treat as UTC.
      const dayKey = row.day.split("T")[0];
      byDay.set(dayKey, Number(row.activity));
    }

    const dataPoints: { date: string, activity: number }[] = [];
    for (let i = 0; i < USER_ACTIVITY_WINDOW_DAYS; i += 1) {
      const day = new Date(since.getTime() + i * ONE_DAY_MS);
      const dayKey = day.toISOString().split("T")[0];
      dataPoints.push({ date: dayKey, activity: byDay.get(dayKey) ?? 0 });
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: { data_points: dataPoints },
    };
  },
});
