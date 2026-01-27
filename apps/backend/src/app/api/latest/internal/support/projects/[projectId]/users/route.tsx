import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { supportAuthSchema, validateSupportTeamMembership } from "../../../support-auth";

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: "List users in a project (Support)",
    description: "Internal support endpoint for listing users in a project. Requires support team membership.",
    tags: ["Internal", "Support"],
  },
  request: yupObject({
    auth: supportAuthSchema,
    params: yupObject({
      projectId: yupString().defined(),
    }).defined(),
    query: yupObject({
      search: yupString().optional(),
      userId: yupString().optional(),
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
    const auth = fullReq.auth ?? throwErr("Missing auth in support users route");
    await validateSupportTeamMembership(auth);

    const { projectId } = req.params;
    const search = req.query.search;
    const userId = req.query.userId;

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
          authMethods: {
            include: {
              otpAuthMethod: true,
              passwordAuthMethod: true,
              passkeyAuthMethod: true,
              oauthAuthMethod: true,
            },
          },
          contactChannels: {
            where: {
              type: "EMAIL",
              isPrimary: "TRUE",
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
      const primaryEmailChannel = user.contactChannels.at(0);
      return {
        id: user.projectUserId,
        displayName: user.displayName,
        primaryEmail: primaryEmailChannel?.value ?? null,
        primaryEmailVerified: primaryEmailChannel?.isVerified ?? false,
        isAnonymous: user.isAnonymous,
        createdAt: user.createdAt.toISOString(),
        profileImageUrl: user.profileImageUrl,
        teams: user.teamMembers.map((tm) => ({
          id: tm.team.teamId,
          displayName: tm.team.displayName,
        })),
        authMethods: user.authMethods.map((am) => {
          if (am.oauthAuthMethod) return `oauth:${am.oauthAuthMethod.configOAuthProviderId}`;
          if (am.passwordAuthMethod) return 'password';
          if (am.passkeyAuthMethod) return 'passkey';
          if (am.otpAuthMethod) return 'otp';
          return 'unknown';
        }),
        clientMetadata: user.clientMetadata,
        serverMetadata: user.serverMetadata,
      };
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: { items, total },
    };
  },
});
