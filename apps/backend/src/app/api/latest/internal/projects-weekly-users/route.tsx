import { ClickHouseError } from "@clickhouse/client";
import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { listManagedProjectIds } from "@/lib/projects";
import { DEFAULT_BRANCH_ID } from "@/lib/tenancies";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { MetricsDataPointsSchema } from "@stackframe/stack-shared/dist/interface/admin-metrics";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupRecord, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
const WEEKLY_USERS_WINDOW_DAYS = 7;
const CHART_WINDOW_DAYS = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type ProjectWeeklyUsers = {
  weekly_users: number,
  daily_users: { date: string, activity: number }[],
};

export function applyProjectWeeklyUsersRows(
  byProject: Map<string, ProjectWeeklyUsers>,
  rows: { projectId: string, day: string, users: number }[],
) {
  // The query emits one synthetic row per project with day set to the ClickHouse
  // Date epoch ("1970-01-01"); those rows hold the weekly total.
  const dailyIndex = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const project = byProject.get(row.projectId);
    if (project == null) {
      continue;
    }
    const dayKey = row.day.split("T")[0];
    if (dayKey === "1970-01-01") {
      project.weekly_users = Number(row.users);
      continue;
    }
    let m = dailyIndex.get(row.projectId);
    if (!m) {
      m = new Map();
      dailyIndex.set(row.projectId, m);
    }
    m.set(dayKey, Number(row.users));
  }

  for (const [id, project] of byProject) {
    const m = dailyIndex.get(id);
    if (!m) continue;
    project.daily_users = project.daily_users.map((point) => ({
      date: point.date,
      activity: m.get(point.date) ?? 0,
    }));
  }
}

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
      projects: yupRecord(yupString().defined(), yupObject({
        weekly_users: yupNumber().integer().defined(),
        daily_users: MetricsDataPointsSchema,
      }).defined()).defined(),
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
    const since = new Date(todayUtc.getTime() - (CHART_WINDOW_DAYS - 1) * ONE_DAY_MS);
    const weeklySince = new Date(todayUtc.getTime() - (WEEKLY_USERS_WINDOW_DAYS - 1) * ONE_DAY_MS);
    const untilExclusive = new Date(todayUtc.getTime() + ONE_DAY_MS);

    const emptySeries = () => {
      const out: { date: string, activity: number }[] = [];
      for (let i = 0; i < CHART_WINDOW_DAYS; i += 1) {
        const day = new Date(since.getTime() + i * ONE_DAY_MS);
        out.push({ date: day.toISOString().split("T")[0], activity: 0 });
      }
      return out;
    };

    const byProject = new Map<string, ProjectWeeklyUsers>();
    for (const id of projectIds) {
      byProject.set(id, {
        weekly_users: 0,
        daily_users: emptySeries(),
      });
    }
    const projectsResponse = () => Object.fromEntries(byProject);

    if (projectIds.length === 0) {
      return {
        statusCode: 200,
        bodyType: "json",
        body: { projects: projectsResponse() },
      };
    }

    const clickhouseClient = getClickhouseAdminClient();
    const queryParams = {
      projectIds,
      branchId: DEFAULT_BRANCH_ID,
      since: since.toISOString().slice(0, 19),
      weeklySince: weeklySince.toISOString().slice(0, 19),
      untilExclusive: untilExclusive.toISOString().slice(0, 19),
    };

    let rows: { projectId: string, day: string, users: number }[] = [];
    try {
      const result = await clickhouseClient.query({
        query: `
          SELECT
            project_id AS projectId,
            toString(toDate(event_at, 'UTC')) AS day,
            uniqExact(assumeNotNull(user_id)) AS users
          FROM analytics_internal.events
          WHERE event_type = '$token-refresh'
            AND project_id IN {projectIds:Array(String)}
            AND branch_id = {branchId:String}
            AND user_id IS NOT NULL
            AND event_at >= {since:DateTime}
            AND event_at < {untilExclusive:DateTime}
            AND coalesce(CAST(data.is_anonymous, 'Nullable(UInt8)'), 0) = 0
          GROUP BY projectId, day
          UNION ALL
          SELECT
            project_id AS projectId,
            '1970-01-01' AS day,
            uniqExact(assumeNotNull(user_id)) AS users
          FROM analytics_internal.events
          WHERE event_type = '$token-refresh'
            AND project_id IN {projectIds:Array(String)}
            AND branch_id = {branchId:String}
            AND user_id IS NOT NULL
            AND event_at >= {weeklySince:DateTime}
            AND event_at < {untilExclusive:DateTime}
            AND coalesce(CAST(data.is_anonymous, 'Nullable(UInt8)'), 0) = 0
          GROUP BY projectId
        `,
        query_params: queryParams,
        format: "JSONEachRow",
      });
      rows = await result.json<{ projectId: string, day: string, users: number }>();
    } catch (error) {
      const captureId = error instanceof ClickHouseError
        ? "internal-projects-weekly-users-clickhouse-error"
        : "internal-projects-weekly-users-unexpected-error";
      captureError(captureId, new StackAssertionError(
        "Failed to load projects weekly users.",
        { cause: error, projectCount: projectIds.length },
      ));
      return {
        statusCode: 200,
        bodyType: "json",
        body: { projects: projectsResponse() },
      };
    }

    applyProjectWeeklyUsersRows(byProject, rows);

    return {
      statusCode: 200,
      bodyType: "json",
      body: { projects: projectsResponse() },
    };
  },
});
