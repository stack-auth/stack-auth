import { ClickHouseError } from "@clickhouse/client";
import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { listManagedProjectIds } from "@/lib/projects";
import { DEFAULT_BRANCH_ID } from "@/lib/tenancies";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { MetricsDataPointsSchema } from "@stackframe/stack-shared/dist/interface/admin-metrics";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupRecord, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
const WINDOW_DAYS = 7;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
      user: adaptSchema,
      project: adaptSchema.defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      projects: yupRecord(yupString().defined(), MetricsDataPointsSchema).defined(),
    }).defined(),
  }),
  handler: async (req) => {
    if (!req.auth.user) {
      throw new KnownErrors.UserAuthenticationRequired();
    }
    if (req.auth.project.id !== "internal") {
      throw new KnownErrors.ExpectedInternalProject();
    }

    const projectIds = await listManagedProjectIds(req.auth.user);

    const now = new Date();
    const todayUtc = new Date(now);
    todayUtc.setUTCHours(0, 0, 0, 0);
    const since = new Date(todayUtc.getTime() - (WINDOW_DAYS - 1) * ONE_DAY_MS);
    const untilExclusive = new Date(todayUtc.getTime() + ONE_DAY_MS);

    const emptySeries = () => {
      const out: { date: string, activity: number }[] = [];
      for (let i = 0; i < WINDOW_DAYS; i += 1) {
        const day = new Date(since.getTime() + i * ONE_DAY_MS);
        out.push({ date: day.toISOString().split("T")[0], activity: 0 });
      }
      return out;
    };

    const byProject: Record<string, { date: string, activity: number }[]> = {};
    for (const id of projectIds) {
      byProject[id] = emptySeries();
    }

    if (projectIds.length === 0) {
      return {
        statusCode: 200,
        bodyType: "json",
        body: { projects: byProject },
      };
    }

    let rows: { projectId: string, day: string, dau: number }[] = [];
    try {
      const clickhouseClient = getClickhouseAdminClient();
      const result = await clickhouseClient.query({
        query: `
          SELECT
            project_id AS projectId,
            toDate(event_at) AS day,
            uniqExact(assumeNotNull(user_id)) AS dau
          FROM analytics_internal.events
          WHERE event_type = '$token-refresh'
            AND project_id IN {projectIds:Array(String)}
            AND branch_id = {branchId:String}
            AND user_id IS NOT NULL
            AND event_at >= {since:DateTime}
            AND event_at < {untilExclusive:DateTime}
            AND coalesce(CAST(data.is_anonymous, 'Nullable(UInt8)'), 0) = 0
          GROUP BY projectId, day
        `,
        query_params: {
          projectIds,
          branchId: DEFAULT_BRANCH_ID,
          since: since.toISOString().slice(0, 19),
          untilExclusive: untilExclusive.toISOString().slice(0, 19),
        },
        format: "JSONEachRow",
      });
      rows = await result.json();
    } catch (error) {
      const captureId = error instanceof ClickHouseError
        ? "internal-projects-dau-clickhouse-error"
        : "internal-projects-dau-unexpected-error";
      captureError(captureId, new StackAssertionError(
        "Failed to load projects DAU.",
        { cause: error, projectCount: projectIds.length },
      ));
      return {
        statusCode: 200,
        bodyType: "json",
        body: { projects: byProject },
      };
    }
    const index = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const dayKey = row.day.split("T")[0];
      let m = index.get(row.projectId);
      if (!m) {
        m = new Map();
        index.set(row.projectId, m);
      }
      m.set(dayKey, Number(row.dau));
    }

    for (const id of projectIds) {
      const m = index.get(id);
      if (!m) continue;
      byProject[id] = byProject[id].map((point) => ({
        date: point.date,
        activity: m.get(point.date) ?? 0,
      }));
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: { projects: byProject },
    };
  },
});
