import {
  createDelivery,
  listDeliveriesForMessage,
} from "@/lib/comms/deliveries";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import {
  commsDeliveryCreateSchema,
  commsDeliverySchema,
} from "@hexclave/shared/dist/interface/comms";
import {
  adaptSchema,
  serverOrHigherAuthTypeSchema,
  yupArray,
  yupBoolean,
  yupNumber,
  yupObject,
  yupString,
} from "@hexclave/shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "List message deliveries",
    description: "Lists per-recipient delivery records for a communications message.",
    tags: ["Comms"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      message_id: yupString().uuid().defined(),
    }).defined(),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      is_paginated: yupBoolean().oneOf([false]).defined(),
      items: yupArray(commsDeliverySchema).defined(),
    }).defined(),
  }),
  handler: async ({ auth, params }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const items = await retryTransaction(prisma, async (tx) => {
      return await listDeliveriesForMessage(tx, {
        tenancyId: auth.tenancy.id,
        messageId: params.message_id,
      });
    });
    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {
        is_paginated: false as const,
        items,
      },
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create message delivery",
    description: "Creates a per-recipient delivery record for outbound lifecycle tracking. Provider adapters are out of scope for this endpoint.",
    tags: ["Comms"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      message_id: yupString().uuid().defined(),
    }).defined(),
    body: commsDeliveryCreateSchema,
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([201]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: commsDeliverySchema,
  }),
  handler: async ({ auth, params, body }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const delivery = await retryTransaction(prisma, async (tx) => {
      return await createDelivery(tx, {
        tenancyId: auth.tenancy.id,
        messageId: params.message_id,
        addressSnapshot: body.address_snapshot,
        participantId: body.participant_id,
        status: body.status,
      });
    });
    return {
      statusCode: 201 as const,
      bodyType: "json" as const,
      body: delivery,
    };
  },
});
