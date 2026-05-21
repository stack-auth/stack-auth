import { globalPrismaClient } from "@/prisma-client";
import { listManagedProjectIds } from "@/lib/projects";
import { DEFAULT_BRANCH_ID } from "@/lib/tenancies";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { MetricsDataPointsSchema } from "@stackframe/stack-shared/dist/interface/admin-metrics";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupRecord, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

const SIGNUPS_WINDOW_DAYS = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type ProjectMetrics = {
  total_users: number,
  daily_signups: { date: string, activity: number }[],
};

export function applyProjectMetricsRows(
  byProject: Map<string, ProjectMetrics>,
  totals: { projectId: string, totalUsers: number }[],
  signups: { projectId: string, day: string, signups: number }[],
) {
  for (const row of totals) {
    const project = byProject.get(row.projectId);
    if (project == null) continue;
    project.total_users = Number(row.totalUsers);
  }

  const dailyIndex = new Map<string, Map<string, number>>();
  for (const row of signups) {
    const project = byProject.get(row.projectId);
    if (project == null) continue;
    const dayKey = row.day.split("T")[0];
    let m = dailyIndex.get(row.projectId);
    if (!m) {
      m = new Map();
      dailyIndex.set(row.projectId, m);
    }
    m.set(dayKey, Number(row.signups));
  }

  for (const [id, project] of byProject) {
    const m = dailyIndex.get(id);
    if (!m) continue;
    project.daily_signups = project.daily_signups.map((point) => ({
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
        total_users: yupNumber().integer().defined(),
        daily_signups: MetricsDataPointsSchema,
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
    const since = new Date(todayUtc.getTime() - (SIGNUPS_WINDOW_DAYS - 1) * ONE_DAY_MS);
    const untilExclusive = new Date(todayUtc.getTime() + ONE_DAY_MS);

    const emptySeries = () => {
      const out: { date: string, activity: number }[] = [];
      for (let i = 0; i < SIGNUPS_WINDOW_DAYS; i += 1) {
        const day = new Date(since.getTime() + i * ONE_DAY_MS);
        out.push({ date: day.toISOString().split("T")[0], activity: 0 });
      }
      return out;
    };

    const byProject = new Map<string, ProjectMetrics>();
    for (const id of projectIds) {
      byProject.set(id, {
        total_users: 0,
        daily_signups: emptySeries(),
      });
    }
    const buildResponse = () => ({
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: { projects: Object.fromEntries(byProject) },
    });

    if (projectIds.length === 0) {
      return buildResponse();
    }

    let totalRows: Array<{ projectId: string, totalUsers: bigint | number }>;
    let signupRows: Array<{ projectId: string, day: Date | string, signups: bigint | number }>;
    try {
      [totalRows, signupRows] = await Promise.all([
        globalPrismaClient.$queryRawUnsafe<Array<{ projectId: string, totalUsers: bigint | number }>>(
          `
            SELECT "mirroredProjectId" AS "projectId", COUNT(*)::bigint AS "totalUsers"
            FROM "ProjectUser"
            WHERE "mirroredProjectId" = ANY($1::text[])
              AND "mirroredBranchId" = $2
              AND "isAnonymous" = false
            GROUP BY "mirroredProjectId"
          `,
          projectIds,
          DEFAULT_BRANCH_ID,
        ),
        globalPrismaClient.$queryRawUnsafe<Array<{ projectId: string, day: Date | string, signups: bigint | number }>>(
          `
            SELECT
              "mirroredProjectId" AS "projectId",
              date_trunc('day', COALESCE("signedUpAt", "createdAt") AT TIME ZONE 'UTC')::date AS "day",
              COUNT(*)::bigint AS "signups"
            FROM "ProjectUser"
            WHERE "mirroredProjectId" = ANY($1::text[])
              AND "mirroredBranchId" = $2
              AND "isAnonymous" = false
              AND COALESCE("signedUpAt", "createdAt") >= $3
              AND COALESCE("signedUpAt", "createdAt") < $4
            GROUP BY "mirroredProjectId", "day"
          `,
          projectIds,
          DEFAULT_BRANCH_ID,
          since,
          untilExclusive,
        ),
      ]);
    } catch (cause) {
      throw new StackAssertionError("Failed to load project metrics.", {
        cause,
        userId: req.auth.user.id,
        projectIds,
        signupsSince: since.toISOString(),
        signupsUntilExclusive: untilExclusive.toISOString(),
      });
    }

    applyProjectMetricsRows(
      byProject,
      totalRows.map((r) => ({ projectId: r.projectId, totalUsers: Number(r.totalUsers) })),
      signupRows.map((r) => ({
        projectId: r.projectId,
        day: r.day instanceof Date ? r.day.toISOString() : String(r.day),
        signups: Number(r.signups),
      })),
    );

    return buildResponse();
  },
});
