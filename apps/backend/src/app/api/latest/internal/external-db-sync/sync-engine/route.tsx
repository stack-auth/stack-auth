import { syncExternalDatabases } from "@/lib/external-db-sync";
import { enqueueExternalDbSync } from "@/lib/external-db-sync-queue";
import { getTenancy } from "@/lib/tenancies";
import { ensureUpstashSignature } from "@/lib/upstash";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { getExternalDbSyncFusebox } from "@/lib/external-db-sync-metadata";
import { yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Sync engine webhook endpoint",
    description: "Receives webhook from QStash to trigger external database sync for a tenant",
    tags: ["External DB Sync"],
    hidden: true,
  },
  request: yupObject({
    headers: yupObject({
      "upstash-signature": yupTuple([yupString()]).defined(),
    }).defined(),
    body: yupObject({
      tenancyId: yupString().defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  handler: async ({ body }, fullReq) => {
    await ensureUpstashSignature(fullReq);

    const fusebox = await getExternalDbSyncFusebox();
    if (!fusebox.syncEngineEnabled) {
      return {
        statusCode: 200,
        bodyType: "success",
      };
    }

    const { tenancyId } = body;

    const tenancy = await getTenancy(tenancyId);
    if (!tenancy) {
      console.warn(`[sync-engine] Tenancy ${tenancyId} in queue but not found, assuming it was deleted.`);
      throw new StatusError(400, `Tenancy ${tenancyId} not found.`);
    }

    const needsResync = await syncExternalDatabases(tenancy);
    if (needsResync) {
      await enqueueExternalDbSync(tenancy.id);
    }

    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
