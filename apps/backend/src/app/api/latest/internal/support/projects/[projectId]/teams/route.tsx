import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { NextRequest, NextResponse } from "next/server";
import { validateSupportAuth } from "../../../support-auth";

// Internal support endpoint for listing teams in a project
// Protected by Stack Auth session - requires @stack-auth.com email

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const auth = await validateSupportAuth(request);
  if (!auth.success) {
    return auth.response;
  }

  const { projectId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const search = searchParams.get("search") ?? undefined;
  const teamId = searchParams.get("teamId") ?? undefined; // Exact team ID lookup
  const limit = Math.min(100, parseInt(searchParams.get("limit") ?? "25", 10));
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  try {
    const tenancy = await getSoleTenancyFromProjectBranch(projectId, DEFAULT_BRANCH_ID);
    const prisma = await getPrismaClientForTenancy(tenancy);

    // Build search filter - exact teamId takes priority
    const searchFilter = teamId
      ? { teamId: teamId }
      : search ? {
        OR: [
          { displayName: { contains: search, mode: "insensitive" as const } },
          { teamId: { contains: search, mode: "insensitive" as const } },
        ],
      } : {};

    const whereClause = {
      tenancyId: tenancy.id,
      ...searchFilter,
    };

    const [teams, total] = await Promise.all([
      prisma.team.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          teamMembers: {
            take: 5,
            include: {
              projectUser: {
                include: {
                  contactChannels: {
                    where: {
                      type: "EMAIL",
                      isPrimary: "TRUE",  // This is a special enum value in Prisma
                    },
                  },
                },
              },
            },
          },
          _count: {
            select: { teamMembers: true },
          },
        },
      }),
      prisma.team.count({ where: whereClause }),
    ]);

    const items = teams.map((team) => ({
      id: team.teamId,
      displayName: team.displayName,
      createdAt: team.createdAt.toISOString(),
      profileImageUrl: team.profileImageUrl,
      memberCount: team._count.teamMembers,
      members: team.teamMembers.map((tm: typeof team.teamMembers[number]) => ({
        userId: tm.projectUser.projectUserId,
        displayName: tm.projectUser.displayName,
        email: tm.projectUser.contactChannels[0]?.value ?? null,
      })),
      clientMetadata: team.clientMetadata,
      serverMetadata: team.serverMetadata,
    }));

    return NextResponse.json({ items, total });
  } catch (error) {
    console.error("Support API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
