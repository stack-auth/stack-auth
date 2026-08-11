import { deploymentToApiShape } from "@/lib/deployments";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

// Runs are loaded with the service id they belong to so the response can report
// the deployment's services without a second query per run.
const RUNS_INCLUDE = {
  runs: {
    include: { service: { select: { serviceId: true } } },
    orderBy: { createdAt: "asc" },
  },
} as const;

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Conclude deployment",
    description: "Marks a deployment as no longer being worked on by the client that created it. A deployment's status is derived from its runs, and a planned service with no run reads as still in flight — correct while a deploy is progressing, but wrong once the client has given up. `hexclave deploy` calls this when it stops, so a deploy that failed before creating some (or all) of its runs becomes terminal instead of polling forever.",
    tags: ["Deployments"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      deployment_id: yupString().uuid().defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, params }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const existing = await prisma.deployment.findUnique({
      where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: params.deployment_id } },
      select: { concludedAt: true },
    });
    if (existing == null) {
      throw new StatusError(404, `No deployment with id ${JSON.stringify(params.deployment_id)} exists in this project.`);
    }
    // IDEMPOTENT, and the first conclusion wins. A retried CLI request (or a
    // second `hexclave deploy` handed the same id) must not move the timestamp:
    // it is used as the finish time for a deployment whose runs never started,
    // so overwriting it would stretch a finished deploy's duration on every
    // retry. Runs created after this point still count — the column only says
    // "the client stopped", never "ignore what arrives later".
    if (existing.concludedAt === null) {
      await prisma.deployment.update({
        where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: params.deployment_id } },
        data: { concludedAt: new Date() },
      });
    }
    const deployment = await prisma.deployment.findUniqueOrThrow({
      where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: params.deployment_id } },
      include: RUNS_INCLUDE,
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: deploymentToApiShape(deployment),
    };
  },
});
