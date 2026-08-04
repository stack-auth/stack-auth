import { ensurePlatformAdmin } from "@/lib/platform-admin";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import {
  adaptSchema,
  clientOrHigherAuthTypeSchema,
  yupArray,
  yupBoolean,
  yupNumber,
  yupObject,
  yupString,
} from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import {
  FEATURED_APP_IDS,
  CANDIDATE_WINDOW_SIZE,
  INTERNAL_PROJECT_ID,
  LIST_RETURN_LIMIT,
  buildNewlyCreatedProjectRows,
  loadProjectActivityMetrics,
  mergeInternalProjectIntoCandidates,
  selectProjectsWithInternalPinned,
} from "./helpers";
import { ProjectRowSchema } from "./schemas";

const RdeFilterSchema = yupString().oneOf(["both", "rde", "not_rde"]).default("both");
const OnboardingFilterSchema = yupString().oneOf(["both", "incomplete", "completed"]).default("both");

function parseNonNegativeInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new StatusError(StatusError.BadRequest, `${name} must be a non-negative integer`);
  }
  return value;
}

function parseBooleanQuery(name: string, raw: string | undefined): boolean {
  if (raw == null || raw === "" || raw === "false" || raw === "0") return false;
  if (raw === "true" || raw === "1") return true;
  throw new StatusError(StatusError.BadRequest, `${name} must be true or false`);
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
    query: yupObject({
      min_users: yupString().optional(),
      rde: RdeFilterSchema.optional(),
      onboarding: OnboardingFilterSchema.optional(),
      activity_24h_after_creation: yupString().optional(),
    }).default({}),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      generated_at: yupString().defined(),
      featured_app_ids: yupArray(yupString().oneOf([...FEATURED_APP_IDS]).defined()).defined(),
      projects: yupArray(ProjectRowSchema).defined(),
      filters: yupObject({
        min_users: yupNumber().integer().defined(),
        rde: RdeFilterSchema.defined(),
        onboarding: OnboardingFilterSchema.defined(),
        activity_24h_after_creation: yupBoolean().defined(),
      }).defined(),
    }).defined(),
  }),
  handler: async (req) => {
    if (!req.auth.user) {
      throw new KnownErrors.UserAuthenticationRequired();
    }
    if (req.auth.project.id !== INTERNAL_PROJECT_ID) {
      throw new KnownErrors.ExpectedInternalProject();
    }
    await ensurePlatformAdmin(req.auth.user);

    const minUsers = parseNonNegativeInt("min_users", req.query.min_users, 0);
    // Schemas carry .default("both"), so validate(undefined) resolves to "both".
    const rde = await RdeFilterSchema.validate(req.query.rde);
    const onboarding = await OnboardingFilterSchema.validate(req.query.onboarding);
    const activity24hAfterCreation = parseBooleanQuery(
      "activity_24h_after_creation",
      req.query.activity_24h_after_creation,
    );

    const projectWhere = {
      ...(rde === "rde" ? { isDevelopmentEnvironment: true } : {}),
      ...(rde === "not_rde" ? { isDevelopmentEnvironment: false } : {}),
      ...(onboarding === "completed" ? { onboardingStatus: "completed" as const } : {}),
      ...(onboarding === "incomplete" ? { onboardingStatus: { not: "completed" as const } } : {}),
    };
    const projectSelect = {
      id: true,
      displayName: true,
      createdAt: true,
      isDevelopmentEnvironment: true,
      onboardingStatus: true,
      ownerTeamId: true,
      stripeAccountId: true,
      description: true,
    } as const;
    const [recentProjects, internalProject] = await Promise.all([
      globalPrismaClient.$replica().project.findMany({
        where: projectWhere,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: CANDIDATE_WINDOW_SIZE,
        select: projectSelect,
      }),
      globalPrismaClient.$replica().project.findUnique({
        where: { id: INTERNAL_PROJECT_ID, ...projectWhere },
        select: projectSelect,
      }),
    ]);
    const projects = mergeInternalProjectIntoCandidates(recentProjects, internalProject);

    // Activity-backed filters cannot run in Prisma because those metrics live
    // in ClickHouse. Filter and limit first, then render each selected project's
    // effective config; app status must never be inferred from raw overrides.
    const activityMetrics = await loadProjectActivityMetrics(projects.map((project) => project.id));
    const matchingProjects = projects.filter((project) => {
      const nonAnonymousUsers = activityMetrics.nonAnonByProjectId.get(project.id) ?? 0;
      if (nonAnonymousUsers < minUsers) return false;
      if (!activity24hAfterCreation) return true;
      const lastActivity = activityMetrics.lastActivityByProjectId.get(project.id);
      return lastActivity != null
        && lastActivity.getTime() >= project.createdAt.getTime() + 24 * 60 * 60 * 1000;
    });
    const selectedProjects = selectProjectsWithInternalPinned(matchingProjects, LIST_RETURN_LIMIT);
    const rows = await buildNewlyCreatedProjectRows(selectedProjects, { activityMetrics });

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {
        generated_at: new Date().toISOString(),
        featured_app_ids: [...FEATURED_APP_IDS],
        projects: rows,
        filters: {
          min_users: minUsers,
          rde,
          onboarding,
          activity_24h_after_creation: activity24hAfterCreation,
        },
      },
    };
  },
});
