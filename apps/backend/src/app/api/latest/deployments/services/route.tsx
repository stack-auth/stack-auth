import { HEXCLAVE_SERVICE_ID, assertMinInstancesAllowedByPlan, listServiceRows, serviceToApiShape, syncServiceDefinitions } from "@/lib/deployments";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { deploymentServiceDefinitionSchema } from "@hexclave/shared/dist/deployments";
import { adaptSchema, serverOrHigherAuthTypeSchema, userSpecifiedIdSchema, yupArray, yupMixed, yupNumber, yupObject, yupRecord, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { randomUUID } from "node:crypto";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "List deployment services",
    description: "Lists all deployment services as last synced from the config file's `services` export, merged with their operational state (deploy status, env vars, domains).",
    tags: ["Deployments"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      items: yupArray(yupMixed().defined()).defined(),
    }).defined(),
  }),
  handler: async ({ auth }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const rows = await listServiceRows(prisma, auth.tenancy);
    const items = await Promise.all(rows.map(async (row) => await serviceToApiShape({
      prisma,
      tenancy: auth.tenancy,
      row,
    })));
    return {
      statusCode: 200,
      bodyType: "json",
      body: { items },
    };
  },
});

export const PUT = createSmartRouteHandler({
  metadata: {
    summary: "Sync deployment service definitions",
    description: "Upserts the service definitions evaluated from the config file's `services` export. Called by `hexclave deploy` before deploying. Additive: services absent from the request keep their existing rows (removal/cleanup is deliberately out of scope for now).",
    tags: ["Deployments"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      services: yupRecord(
        userSpecifiedIdSchema("serviceId").notOneOf([HEXCLAVE_SERVICE_ID], `The service id ${JSON.stringify(HEXCLAVE_SERVICE_ID)} is reserved for the managed Hexclave service`),
        deploymentServiceDefinitionSchema.defined(),
      ).defined(),
    }).defined(),
    method: yupString().oneOf(["PUT"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      sync_id: yupString().uuid().defined(),
      items: yupArray(yupMixed().defined()).defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    if (Object.keys(body.services).length === 0) {
      throw new StatusError(400, "The services record must contain at least one service. (Nothing to sync — the config file's `services` export is empty.)");
    }
    await assertMinInstancesAllowedByPlan(auth.tenancy, body.services);
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const syncId = randomUUID();
    // One transaction: the sync releases volume ids before re-claiming them, so a
    // failure partway through would otherwise commit the release and leave a
    // service silently volume-less on its next deploy.
    //
    // SERIALIZABLE, like the deployment-create route. That release-then-reclaim spans several
    // writes against the (tenancyId, volumeId) unique index, so two concurrent syncs moving
    // the same volume id between services interleave into a constraint violation — a 500 on a
    // sync that is perfectly valid against the state it would have seen. At this level the
    // loser gets a serialization failure that retryTransaction retries against the committed
    // newer state instead.
    await retryTransaction(prisma, async (transaction) => {
      await syncServiceDefinitions(transaction, auth.tenancy, body.services, syncId);
    }, { level: "serializable" });
    const rows = await listServiceRows(prisma, auth.tenancy);
    const items = await Promise.all(rows.map(async (row) => await serviceToApiShape({
      prisma,
      tenancy: auth.tenancy,
      row,
    })));
    return {
      statusCode: 200,
      bodyType: "json",
      body: { sync_id: syncId, items },
    };
  },
});
