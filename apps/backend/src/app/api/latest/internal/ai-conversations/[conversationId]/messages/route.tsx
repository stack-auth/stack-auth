import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

async function getOwnedConversation(conversationId: string, userId: string) {
  const conversation = await globalPrismaClient.aiConversation.findUnique({
    where: { id: conversationId },
  });
  if (!conversation || conversation.projectUserId !== userId) {
    throw new StatusError(StatusError.NotFound, "Conversation not found");
  }
  return conversation;
}

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
          role: yupString().defined(),
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

    await globalPrismaClient.aiMessage.deleteMany({
      where: { conversationId: params.conversationId },
    });

    if (body.messages.length > 0) {
      await globalPrismaClient.aiMessage.createMany({
        data: body.messages.map((msg) => ({
          conversationId: params.conversationId,
          role: msg.role,
          content: msg.content as object,
        })),
      });
    }

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {},
    };
  },
});
