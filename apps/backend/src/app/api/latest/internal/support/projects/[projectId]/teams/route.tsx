import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { supportAuthSchema, validateSupportTeamMembership } from "../../../support-auth";

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: "List teams in a project (Support)",
    description: "Internal support endpoint for listing teams in a project. Requires support team membership.",
    tags: ["Internal", "Support"],
  },
  request: yupObject({
    auth: supportAuthSchema,
    params: yupObject({
      projectId: yupString().defined(),
    }).defined(),
    query: yupObject({
      search: yupString().optional(),
      teamId: yupString().optional(),
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
    const auth = fullReq.auth ?? throwErr("Missing auth in support teams route");
    await validateSupportTeamMembership(auth);

    const { projectId } = req.params;
    const search = req.query.search;
    const teamId = req.query.teamId;

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
                      isPrimary: "TRUE",
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

    return {
      statusCode: 200,
      bodyType: "json",
      body: { items, total },
    };
  },
});
