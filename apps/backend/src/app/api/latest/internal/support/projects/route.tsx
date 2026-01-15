import { renderedOrganizationConfigToProjectCrud } from "@/lib/config";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { NextRequest, NextResponse } from "next/server";
import { validateSupportAuth } from "../support-auth";

// Internal support endpoint for listing all projects
// Protected by Stack Auth session - requires support team membership

export async function GET(request: NextRequest) {
  const auth = await validateSupportAuth(request);
  if (!auth.success) {
    return auth.response;
  }

  const searchParams = request.nextUrl.searchParams;
  const search = searchParams.get("search") ?? undefined;
  const projectId = searchParams.get("projectId") ?? undefined; // Exact project ID lookup
  const limit = Math.min(100, parseInt(searchParams.get("limit") ?? "25", 10));
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  try {
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
        try {
          const tenancy = await getSoleTenancyFromProjectBranch(project.id, DEFAULT_BRANCH_ID);
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
        } catch {
          // Ignore errors, config will be null
        }

        // Try to get owner team info if this project has an ownerTeamId
        // Owner teams are in the "internal" project
        let ownerTeam = null;
        if (project.ownerTeamId) {
          try {
            const internalTenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID);
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
          } catch {
            // Ignore errors
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

    return NextResponse.json({ items, total });
  } catch (error) {
    console.error("[Support API] Error listing projects:", error);
    return NextResponse.json(
      { error: `Internal server error: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

