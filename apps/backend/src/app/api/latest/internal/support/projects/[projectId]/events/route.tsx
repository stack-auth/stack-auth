import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { globalPrismaClient } from "@/prisma-client";
import { NextRequest, NextResponse } from "next/server";
import { validateSupportAuth } from "../../../support-auth";

// Internal support endpoint for listing events in a project
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
  const limit = Math.min(100, parseInt(searchParams.get("limit") ?? "30", 10));
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  try {
    const tenancy = await getSoleTenancyFromProjectBranch(projectId, DEFAULT_BRANCH_ID);

    // Events are stored in the global prisma client with a data filter by tenancy
    // We need to query by the data field's tenancyId
    const events = await globalPrismaClient.event.findMany({
      where: {
        data: {
          path: ["tenancyId"],
          equals: tenancy.id,
        },
      },
      orderBy: { eventStartedAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        endUserIpInfoGuess: true,
      },
    });

    const total = await globalPrismaClient.event.count({
      where: {
        data: {
          path: ["tenancyId"],
          equals: tenancy.id,
        },
      },
    });

    const items = events.map((event) => ({
      id: event.id,
      eventTypes: event.systemEventTypeIds,
      eventStartedAt: event.eventStartedAt.toISOString(),
      eventEndedAt: event.eventEndedAt.toISOString(),
      isWide: event.isWide,
      data: event.data as Record<string, unknown>,
      ipInfo: event.endUserIpInfoGuess ? {
        ip: event.endUserIpInfoGuess.ip,
        countryCode: event.endUserIpInfoGuess.countryCode,
        cityName: event.endUserIpInfoGuess.cityName,
        isTrusted: event.isEndUserIpInfoGuessTrusted,
      } : null,
    }));

    return NextResponse.json({ items, total });
  } catch (error) {
    console.error("[Support API] Error fetching events:", error);
    return NextResponse.json(
      { error: `Internal server error: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
