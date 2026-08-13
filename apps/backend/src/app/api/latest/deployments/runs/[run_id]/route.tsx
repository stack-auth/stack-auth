import { refreshRunFromVercel, runToApiShape } from "@/lib/deployments";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get deployment run",
    description: "Returns the current status of a deployment run. Non-terminal runs are refreshed from the deployment target on read (poll this endpoint to follow a deploy).",
    tags: ["Deployments"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      run_id: yupString().uuid().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, params }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const run = await prisma.deploymentRun.findUnique({
      where: {
        tenancyId_id: {
          tenancyId: auth.tenancy.id,
          id: params.run_id,
        },
      },
    });
    if (run == null) {
      throw new StatusError(404, "No deployment run found with the given id.");
    }
    await refreshRunFromVercel(prisma, auth.tenancy, run);
    const refreshed = await prisma.deploymentRun.findUnique({
      where: {
        tenancyId_id: {
          tenancyId: auth.tenancy.id,
          id: params.run_id,
        },
      },
      include: { service: true },
    }) ?? throwErr("Deployment run disappeared during refresh; this should never happen because runs are never deleted outside of cascade deletes");
    return {
      statusCode: 200,
      bodyType: "json",
      body: runToApiShape(refreshed, refreshed.service.serviceId),
    };
  },
});
