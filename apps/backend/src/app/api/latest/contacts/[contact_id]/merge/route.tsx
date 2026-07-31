import { mergeContacts } from "@/lib/comms/contacts";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { contactSchema } from "@hexclave/shared/dist/interface/comms";
import {
  adaptSchema,
  jsonSchema,
  serverOrHigherAuthTypeSchema,
  yupBoolean,
  yupNumber,
  yupObject,
  yupString,
} from "@hexclave/shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Merge contacts",
    description: "Merges the contact identified by contact_id (source) into target_contact_id. Idempotent via idempotency_key.",
    tags: ["Contacts"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      contact_id: yupString().uuid().defined(),
    }).defined(),
    body: yupObject({
      target_contact_id: yupString().uuid().defined(),
      idempotency_key: yupString().min(1).defined(),
      actor_user_id: yupString().uuid().nullable().optional(),
      reason: yupString().nullable().optional(),
      metadata: jsonSchema.optional(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      operation_id: yupString().uuid().defined(),
      replayed: yupBoolean().defined(),
      contact: contactSchema,
    }).defined(),
  }),
  handler: async ({ auth, params, body }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const result = await retryTransaction(prisma, async (tx) => {
      return await mergeContacts(tx, {
        tenancyId: auth.tenancy.id,
        sourceId: params.contact_id,
        targetId: body.target_contact_id,
        idempotencyKey: body.idempotency_key,
        actorUserId: body.actor_user_id,
        reason: body.reason,
        metadata: body.metadata,
      });
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        operation_id: result.operationId,
        replayed: result.replayed,
        contact: result.contact,
      },
    };
  },
});
