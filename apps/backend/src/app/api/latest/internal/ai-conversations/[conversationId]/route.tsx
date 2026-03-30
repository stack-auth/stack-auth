import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getOwnedConversation } from "../utils";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get AI conversation",
    description: "Fetch a single AI conversation with all its messages",
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
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      id: yupString().defined(),
      title: yupString().defined(),
      projectId: yupString().defined(),
      messages: yupArray(yupObject({
        id: yupString().defined(),
        role: yupString().defined(),
        content: yupMixed().defined(),
      }).noUnknown(false)).defined(),
    }).defined(),
  }),
  handler: async ({ auth, params }) => {
    const conversation = await getOwnedConversation(params.conversationId, auth.user.id);

    const messages = await globalPrismaClient.aiMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { position: "asc" },
      select: {
        id: true,
        role: true,
        content: true,
      },
    });

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {
        id: conversation.id,
        title: conversation.title,
        projectId: conversation.projectId,
        messages: messages.map(m => ({ ...m, content: m.content as object })),
      },
    };
  },
});

export const PATCH = createSmartRouteHandler({
  metadata: {
    summary: "Update AI conversation",
    description: "Update the title of an AI conversation",
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
      title: yupString().defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({}).defined(),
  }),
  handler: async ({ auth, params, body }) => {
    await getOwnedConversation(params.conversationId, auth.user.id);

    await globalPrismaClient.aiConversation.update({
      where: { id: params.conversationId },
      data: { title: body.title },
    });

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {},
    };
  },
});

export const DELETE = createSmartRouteHandler({
  metadata: {
    summary: "Delete AI conversation",
    description: "Delete an AI conversation and all its messages",
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
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({}).defined(),
  }),
  handler: async ({ auth, params }) => {
    await getOwnedConversation(params.conversationId, auth.user.id);

    await globalPrismaClient.aiConversation.delete({
      where: { id: params.conversationId },
    });

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {},
    };
  },
});
