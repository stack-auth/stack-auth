import { syncExternalDatabases } from "@/lib/external-db-sync";
import { getTenancy } from "@/lib/tenancies";
import { ensureUpstashSignature } from "@/lib/upstash";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupBoolean, yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";

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
      tenantId: yupString().defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().defined(),
      tenantId: yupString().defined(),
      timestamp: yupString().defined(),
    }).defined(),
  }),
  handler: async ({ body }, fullReq) => {
    await ensureUpstashSignature(fullReq);

    const { tenantId } = body;
    const timestamp = new Date().toISOString();

    const tenancy = await getTenancy(tenantId);
    if (!tenancy) {
      console.error(`Tenant not found: ${tenantId}`);
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          success: false,
          tenantId,
          timestamp,
        },
      };
    }

    try {
      await syncExternalDatabases(tenancy);
    } catch (error: any) {
      console.error(` Error syncing external databases for tenant ${tenantId}:`, error);
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        success: true,
        tenantId,
        timestamp,
      },
    };
  },
});
