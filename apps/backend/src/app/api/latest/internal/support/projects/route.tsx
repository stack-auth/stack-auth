import { renderedOrganizationConfigToProjectCrud } from "@/lib/config";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { supportAuthSchema, validateSupportTeamMembership } from "../support-auth";

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: "List all projects (Support)",
    description: "Internal support endpoint for listing all projects. Requires support team membership.",
    tags: ["Internal", "Support"],
  },
  request: yupObject({
    auth: supportAuthSchema,
    query: yupObject({
      search: yupString().optional(),
      projectId: yupString().optional(),
      limit: yupString().optional(),
      offset: yupString().optional(),
    }),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      items: yupMixed().defined(),
      total: yupNumber().defined(),
    }).defined(),
  }),
  handler: async (req, fullReq) => {
    const auth = fullReq.auth ?? throwErr("Missing auth in support projects route");
    await validateSupportTeamMembership(auth);

    const search = req.query.search;
    const projectId = req.query.projectId;

    // Parse and validate limit: must be finite, positive, capped at 100, default 25
    const parsedLimit = parseInt(req.query.limit ?? "", 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 25;

    // Parse and validate offset: must be finite, non-negative, default 0
    const parsedOffset = parseInt(req.query.offset ?? "", 10);
    const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0
      ? parsedOffset
      : 0;

    // Build search filter - exact projectId takes priority
    const searchFilter = projectId
      ? { id: projectId }
      : search
        ? {
          OR: [
            { displayName: { contains: search, mode: "insensitive" as const } },
            { id: { contains: search, mode: "insensitive" as const } },
            { description: { contains: search, mode: "insensitive" as const } },
          ],
        }
        : {};

    const whereClause = {
      ...searchFilter,
    };

    const [projects, total] = await Promise.all([
      globalPrismaClient.project.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          _count: {
            select: {
              tenancies: true,
            },
          },
        },
      }),
      globalPrismaClient.project.count({ where: whereClause }),
    ]);

    // Fetch full details for each project
    const items = await Promise.all(
      projects.map(async (project) => {
        // Get the full rendered config from the tenancy (converted to CRUD format)
        let fullConfig: ReturnType<typeof renderedOrganizationConfigToProjectCrud> | null = null;
        let userCount = 0;
        let teamCount = 0;

        const tenancy = await getSoleTenancyFromProjectBranch(project.id, DEFAULT_BRANCH_ID, true);
        if (tenancy) {
          // Convert to the same format used by the public API
          fullConfig = renderedOrganizationConfigToProjectCrud(tenancy.config);

          // Get counts from the tenancy's prisma client
          const prisma = await getPrismaClientForTenancy(tenancy);
          userCount = await prisma.projectUser.count({
            where: { tenancyId: tenancy.id },
          });
          teamCount = await prisma.team.count({
            where: { tenancyId: tenancy.id },
          });
        }

        // Try to get owner team info if this project has an ownerTeamId
        // Owner teams are in the "internal" project
        let ownerTeam = null;
        if (project.ownerTeamId) {
          const internalTenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID, true);
          if (internalTenancy) {
            const internalPrisma = await getPrismaClientForTenancy(internalTenancy);
            const team = await internalPrisma.team.findFirst({
              where: {
                tenancyId: internalTenancy.id,
                teamId: project.ownerTeamId,
              },
            });
            if (team) {
              ownerTeam = {
                id: team.teamId,
                displayName: team.displayName,
              };
            }
          }
        }

        return {
          id: project.id,
          displayName: project.displayName,
          description: project.description,
          createdAt: project.createdAt.toISOString(),
          updatedAt: project.updatedAt.toISOString(),
          isProductionMode: project.isProductionMode,
          ownerTeamId: project.ownerTeamId,
          ownerTeam,
          logoUrl: project.logoUrl,
          logoFullUrl: project.logoFullUrl,
          logoDarkModeUrl: project.logoDarkModeUrl,
          logoFullDarkModeUrl: project.logoFullDarkModeUrl,
          stripeAccountId: project.stripeAccountId,
          userCount,
          teamCount,
          tenancyCount: project._count.tenancies,
          // Full rendered config with all settings
          config: fullConfig,
          // Raw override for debugging
          configOverride: project.projectConfigOverride,
        };
      })
    );

    return {
      statusCode: 200,
      bodyType: "json",
      body: { items, total },
    };
  },
});

