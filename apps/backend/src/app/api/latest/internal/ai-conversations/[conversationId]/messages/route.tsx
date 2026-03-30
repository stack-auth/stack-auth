import { globalPrismaClient, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getOwnedConversation } from "../../utils";

export const PUT = createSmartRouteHandler({
  metadata: {
    summary: "Replace conversation messages",
    description: "Replace all messages in a conversation",
  },
  request: yupObject({
    auth: yupObject({
      type: adaptSchema,
      user: adaptSchema.defined(),
      project: yupObject({
        id: yupString().oneOf(["internal"]).defined(),
      }).defined(),
    }).defined(),
    params: yupObject({
      conversationId: yupString().defined(),
    }),
    body: yupObject({
      messages: yupArray(
        yupObject({
          role: yupString().oneOf(["user", "assistant"]).defined(),
          content: yupMixed().defined(),
        })
      ).defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({}).defined(),
  }),
  handler: async ({ auth, params, body }) => {
    await getOwnedConversation(params.conversationId, auth.user.id);

    await retryTransaction(globalPrismaClient, async (tx) => {
      await tx.aiMessage.deleteMany({
        where: { conversationId: params.conversationId },
      });

      if (body.messages.length > 0) {
        await tx.aiMessage.createMany({
          data: body.messages.map((msg, index) => ({
            conversationId: params.conversationId,
            position: index,
            role: msg.role,
            content: msg.content as object,
          })),
        });
      }

      await tx.aiConversation.update({
        where: { id: params.conversationId },
        data: { updatedAt: new Date() },
      });
    });

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {},
    };
  },
});
