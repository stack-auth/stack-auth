import { mergeConversations } from "@/lib/comms/conversations";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import {
  commsConversationSchema,
  commsMergeConversationsRequestSchema,
} from "@hexclave/shared/dist/interface/comms";
import {
  adaptSchema,
  serverOrHigherAuthTypeSchema,
  yupBoolean,
  yupNumber,
  yupObject,
  yupString,
} from "@hexclave/shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Merge conversations",
    description: "Merges this conversation into target_conversation_id. Idempotent via idempotency_key.",
    tags: ["Comms"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      conversation_id: yupString().uuid().defined(),
    }).defined(),
    body: commsMergeConversationsRequestSchema.omit(["source_conversation_id"]),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      operation_id: yupString().uuid().defined(),
      replayed: yupBoolean().defined(),
      conversation: commsConversationSchema,
    }).defined(),
  }),
  handler: async ({ auth, params, body }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const result = await retryTransaction(prisma, async (tx) => {
      return await mergeConversations(tx, {
        tenancyId: auth.tenancy.id,
        request: {
          ...body,
          source_conversation_id: params.conversation_id,
        },
      });
    });
    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {
        operation_id: result.operationId,
        replayed: result.replayed,
        conversation: result.conversation,
      },
    };
  },
});
