import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { NextRequest, NextResponse } from "next/server";
import { validateSupportAuth } from "../../../support-auth";

// Internal support endpoint for listing users in a project
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
  const userId = searchParams.get("userId") ?? undefined; // Exact user ID lookup
  const limit = Math.min(100, parseInt(searchParams.get("limit") ?? "25", 10));
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  try {
    console.log(`[Support API] Fetching users for project: ${projectId}, userId: ${userId ?? 'none'}, search: ${search ?? 'none'}`);
    const tenancy = await getSoleTenancyFromProjectBranch(projectId, DEFAULT_BRANCH_ID);
    const prisma = await getPrismaClientForTenancy(tenancy);

    // Build search filter - exact userId takes priority
    const searchFilter = userId 
      ? { projectUserId: userId }
      : search ? {
          OR: [
            { displayName: { contains: search, mode: "insensitive" as const } },
            { projectUserId: { contains: search, mode: "insensitive" as const } },
            {
              contactChannels: {
                some: {
                  value: { contains: search, mode: "insensitive" as const },
                },
              },
            },
          ],
        } : {};

    const [users, total] = await Promise.all([
      prisma.projectUser.findMany({
        where: {
          tenancyId: tenancy.id,
          ...searchFilter,
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          teamMembers: {
            include: {
              team: true,
            },
          },
          authMethods: true,
          contactChannels: {
            where: {
              type: "EMAIL",
              isPrimary: "TRUE",  // This is a special enum value in Prisma
            },
          },
        },
      }),
      prisma.projectUser.count({
        where: {
          tenancyId: tenancy.id,
          ...searchFilter,
        },
      }),
    ]);

    const items = users.map((user) => {
      const primaryEmailChannel = user.contactChannels[0];
      return {
        id: user.projectUserId,
        displayName: user.displayName,
        primaryEmail: primaryEmailChannel?.value ?? null,
        primaryEmailVerified: primaryEmailChannel?.isVerified ?? false,
        isAnonymous: user.isAnonymous ?? false,
        createdAt: user.createdAt.toISOString(),
        profileImageUrl: user.profileImageUrl,
        teams: user.teamMembers.map((tm) => ({
          id: tm.team.teamId,
          displayName: tm.team.displayName,
        })),
        authMethods: user.authMethods.map((am) => am.authMethodIdentifier),
        clientMetadata: user.clientMetadata,
        serverMetadata: user.serverMetadata,
      };
    });

    console.log(`[Support API] Found ${total} users`);
    return NextResponse.json({ items, total });
  } catch (error) {
    console.error("[Support API] Error fetching users:", error);
    return NextResponse.json(
      { error: `Internal server error: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
