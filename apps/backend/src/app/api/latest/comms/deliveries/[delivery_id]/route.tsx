import { getDelivery, updateDeliveryStatus } from "@/lib/comms/deliveries";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import {
  commsDeliverySchema,
  commsDeliveryStatusUpdateSchema,
} from "@hexclave/shared/dist/interface/comms";
import {
  adaptSchema,
  serverOrHigherAuthTypeSchema,
  yupNumber,
  yupObject,
  yupString,
} from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get delivery",
    description: "Gets a delivery record including attempts.",
    tags: ["Comms"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      delivery_id: yupString().uuid().defined(),
    }).defined(),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: commsDeliverySchema,
  }),
  handler: async ({ auth, params }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const delivery = await retryTransaction(prisma, async (tx) => {
      return await getDelivery(tx, {
        tenancyId: auth.tenancy.id,
        deliveryId: params.delivery_id,
      });
    });
    if (delivery == null) {
      throw new StatusError(StatusError.NotFound, "Delivery not found");
    }
    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: delivery,
    };
  },
});

export const PATCH = createSmartRouteHandler({
  metadata: {
    summary: "Update delivery status",
    description: "Updates delivery lifecycle status and optional provider diagnostics.",
    tags: ["Comms"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      delivery_id: yupString().uuid().defined(),
    }).defined(),
    body: commsDeliveryStatusUpdateSchema,
    method: yupString().oneOf(["PATCH"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: commsDeliverySchema,
  }),
  handler: async ({ auth, params, body }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const delivery = await retryTransaction(prisma, async (tx) => {
      return await updateDeliveryStatus(tx, {
        tenancyId: auth.tenancy.id,
        deliveryId: params.delivery_id,
        status: body.status,
        providerMessageId: body.provider_message_id,
        skippedReason: body.skipped_reason,
        lastErrorPublic: body.last_error_public,
        lastErrorInternal: body.last_error_internal,
      });
    });
    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: delivery,
    };
  },
});
