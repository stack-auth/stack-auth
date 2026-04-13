import { globalPrismaClient, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "List AI conversations",
    description: "List AI conversations for the current user filtered by project",
  },
  request: yupObject({
    auth: yupObject({
      type: adaptSchema,
      user: adaptSchema.defined(),
      project: yupObject({
        id: yupString().oneOf(["internal"]).defined(),
      }).defined(),
    }).defined(),
    query: yupObject({
      projectId: yupString().defined(),
    }),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      conversations: yupArray(yupObject({
        id: yupString().defined(),
        title: yupString().defined(),
        projectId: yupString().defined(),
        updatedAt: yupString().defined(),
      }).noUnknown(false)).defined(),
    }).defined(),
  }),
  handler: async ({ auth, query }) => {
    const conversations = await globalPrismaClient.aiConversation.findMany({
      where: {
        projectUserId: auth.user.id,
        projectId: query.projectId,
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        projectId: true,
        updatedAt: true,
      },
    });

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {
        conversations: conversations.map(c => ({
          ...c,
          updatedAt: c.updatedAt.toISOString(),
        })),
      },
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create AI conversation",
    description: "Create a new AI conversation with optional initial messages",
  },
  request: yupObject({
    auth: yupObject({
      type: adaptSchema,
      user: adaptSchema.defined(),
      project: yupObject({
        id: yupString().oneOf(["internal"]).defined(),
      }).defined(),
    }).defined(),
    body: yupObject({
      title: yupString().defined(),
      projectId: yupString().defined(),
      messages: yupArray(
        yupObject({
          role: yupString().oneOf(["user", "assistant"]).defined(),
          content: yupMixed().defined(),
        })
      ).defined(),
    }),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      id: yupString().defined(),
      title: yupString().defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    const conversation = await retryTransaction(globalPrismaClient, async (tx) => {
      const conv = await tx.aiConversation.create({
        data: {
          projectUserId: auth.user.id,
          title: body.title,
          projectId: body.projectId,
        },
      });

      if (body.messages.length > 0) {
        await tx.aiMessage.createMany({
          data: body.messages.map((msg, index) => ({
            conversationId: conv.id,
            position: index,
            role: msg.role,
            content: msg.content as object,
          })),
        });
      }

      return conv;
    });

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: { id: conversation.id, title: conversation.title },
    };
  },
});
