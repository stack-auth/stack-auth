import {
  authenticatedUserAuthSchema,
  publicConversationListResponseSchema,
  toPublicConversationSummary,
} from "@/lib/conversations-api";
import {
  createConversation,
  listConversationSummaries,
} from "@/lib/conversations";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import {
  yupNumber,
  yupObject,
  yupString,
} from "@stackframe/stack-shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "List conversations for the current user",
    description: "List conversations visible to the currently authenticated user",
    tags: ["Conversations"],
  },
  request: yupObject({
    auth: authenticatedUserAuthSchema,
    query: yupObject({
      query: yupString().optional(),
    }).defined(),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: publicConversationListResponseSchema,
  }),
  handler: async ({ auth, query }) => {
    const conversations = await listConversationSummaries({
      tenancyId: auth.tenancy.id,
      userId: auth.user.id,
      query: query.query,
      includeInternalNotes: false,
    });

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {
        conversations: conversations.map(toPublicConversationSummary),
      },
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create a conversation",
    description: "Create a new conversation as the current user",
    tags: ["Conversations"],
  },
  request: yupObject({
    auth: authenticatedUserAuthSchema,
    body: yupObject({
      subject: yupString().trim().min(1).defined(),
      message: yupString().trim().min(1).defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      conversation_id: yupString().uuid().defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    const result = await createConversation({
      tenancyId: auth.tenancy.id,
      userId: auth.user.id,
      subject: body.subject,
      priority: "normal",
      source: "chat",
      channelType: "chat",
      adapterKey: "support-chat",
      body: body.message,
      sender: {
        type: "user",
        id: auth.user.id,
        displayName: auth.user.display_name ?? null,
        primaryEmail: auth.user.primary_email ?? null,
      },
    });

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {
        conversation_id: result.conversationId,
      },
    };
  },
});
