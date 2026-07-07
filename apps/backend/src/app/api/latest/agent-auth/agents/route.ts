import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { serializeAgent } from "@/lib/agent-auth/serialization";
import { getAgentAuthTenancy, getHeader } from "@/lib/agent-auth/requests";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { jsonSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["server", "admin"]).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: jsonSchema.defined(),
  }),
  handler: async (_req, fullReq) => {
    const projectId = getHeader(fullReq, "x-stack-project-id") ?? getHeader(fullReq, "x-hexclave-project-id");
    if (!projectId) throw new StatusError(StatusError.BadRequest, "Project id is required");
    const tenancy = await getAgentAuthTenancy(projectId);
    const prisma = await getPrismaClientForTenancy(tenancy);
    const agents = await prisma.agent.findMany({
      where: { tenancyId: tenancy.id },
      include: {
        host: true,
        projectUser: true,
        capabilityGrants: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {
        agents: agents.map(serializeAgent),
      },
    };
  },
});
