import { getServiceDefinitionOrThrow, isTerminalRunStatus, refreshRunFromVercel, runToApiShape } from "@/lib/deployments";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, userSpecifiedIdSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "List deployment runs",
    description: "Lists the most recent deployment runs of a service, newest first. Non-terminal runs are refreshed from the deployment target on read.",
    tags: ["Deployments"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      service_id: userSpecifiedIdSchema("serviceId").defined(),
    }).defined(),
    query: yupObject({
      limit: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      items: yupArray(yupMixed().defined()).defined(),
    }).defined(),
  }),
  handler: async ({ auth, params, query }) => {
    const limitRaw = query.limit == null ? 20 : parseInt(query.limit, 10);
    if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 100) {
      throw new StatusError(400, "limit must be an integer between 1 and 100");
    }
    getServiceDefinitionOrThrow(auth.tenancy, params.service_id);
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const service = await prisma.deploymentService.findUnique({
      where: {
        tenancyId_serviceId: {
          tenancyId: auth.tenancy.id,
          serviceId: params.service_id,
        },
      },
    });
    if (service == null) {
      return {
        statusCode: 200,
        bodyType: "json",
        body: { items: [] },
      } as const;
    }
    const runs = await prisma.deploymentRun.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        deploymentServiceId: service.id,
      },
      orderBy: { createdAt: "desc" },
      take: limitRaw,
    });
    // Only the newest non-terminal runs need a refresh; there can be at most a
    // handful in flight at once, so refreshing serially is fine.
    for (const run of runs) {
      if (!isTerminalRunStatus(run.status)) {
        await refreshRunFromVercel(prisma, auth.tenancy, run);
      }
    }
    const refreshedRuns = await prisma.deploymentRun.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        deploymentServiceId: service.id,
      },
      orderBy: { createdAt: "desc" },
      take: limitRaw,
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        items: refreshedRuns.map((run) => runToApiShape(run, params.service_id)),
      },
    };
  },
});
