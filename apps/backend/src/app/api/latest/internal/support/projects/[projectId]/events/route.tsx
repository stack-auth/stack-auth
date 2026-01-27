import { DEFAULT_BRANCH_ID } from "@/lib/tenancies";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { supportAuthSchema, validateSupportTeamMembership } from "../../../support-auth";

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: "List events in a project (Support)",
    description: "Internal support endpoint for listing events in a project. Requires support team membership.",
    tags: ["Internal", "Support"],
  },
  request: yupObject({
    auth: supportAuthSchema,
    params: yupObject({
      projectId: yupString().defined(),
    }).defined(),
    query: yupObject({
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
    const auth = fullReq.auth ?? throwErr("Missing auth in support events route");
    await validateSupportTeamMembership(auth);

    const { projectId } = req.params;

    // Parse and validate limit: must be finite, positive, capped at 100, default 30
    const parsedLimit = parseInt(req.query.limit ?? "", 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 30;

    // Parse and validate offset: must be finite, non-negative, default 0
    const parsedOffset = parseInt(req.query.offset ?? "", 10);
    const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0
      ? parsedOffset
      : 0;

    // Events are stored with projectId in the data field
    const whereClause = {
      AND: [
        {
          data: {
            path: ["projectId"],
            equals: projectId,
          },
        },
        {
          data: {
            path: ["branchId"],
            equals: DEFAULT_BRANCH_ID,
          },
        },
      ],
    };

    const events = await globalPrismaClient.event.findMany({
      where: whereClause,
      orderBy: { eventStartedAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        endUserIpInfoGuess: true,
      },
    });

    const total = await globalPrismaClient.event.count({
      where: whereClause,
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

    return {
      statusCode: 200,
      bodyType: "json",
      body: { items, total },
    };
  },
});
