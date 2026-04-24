import {
  authenticatedUserAuthSchema,
  conversationIdRouteParamsSchema,
  publicConversationDetailResponseSchema,
  toPublicConversationDetail,
} from "@/lib/conversations-api";
import {
  appendConversationMessage,
  getConversationDetail,
} from "@/lib/conversations";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import {
  yupNumber,
  yupObject,
  yupString,
} from "@stackframe/stack-shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get a conversation for the current user",
    description: "Get conversation detail visible to the currently authenticated user",
    tags: ["Conversations"],
  },
  request: yupObject({
    auth: authenticatedUserAuthSchema,
    params: conversationIdRouteParamsSchema,
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: publicConversationDetailResponseSchema,
  }),
  handler: async ({ auth, params }) => {
    const detail = await getConversationDetail({
      tenancyId: auth.tenancy.id,
      conversationId: params.conversationId,
      viewerProjectUserId: auth.user.id,
      includeInternalNotes: false,
    });

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: toPublicConversationDetail(detail),
    };
  },
});

export const PATCH = createSmartRouteHandler({
  metadata: {
    summary: "Reply to a conversation",
    description: "Append a user message to an existing conversation",
    tags: ["Conversations"],
  },
  request: yupObject({
    auth: authenticatedUserAuthSchema,
    params: conversationIdRouteParamsSchema,
    body: yupObject({
      message: yupString().trim().min(1).defined(),
    }).defined(),
    method: yupString().oneOf(["PATCH"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: publicConversationDetailResponseSchema,
  }),
  handler: async ({ auth, params, body }) => {
    await appendConversationMessage({
      tenancyId: auth.tenancy.id,
      conversationId: params.conversationId,
      messageType: "message",
      body: body.message,
      viewerProjectUserId: auth.user.id,
      channelType: "chat",
      adapterKey: "support-chat",
      sender: {
        type: "user",
        id: auth.user.id,
        displayName: auth.user.display_name ?? null,
        primaryEmail: auth.user.primary_email ?? null,
      },
    });

    const detail = await getConversationDetail({
      tenancyId: auth.tenancy.id,
      conversationId: params.conversationId,
      viewerProjectUserId: auth.user.id,
      includeInternalNotes: false,
    });

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: toPublicConversationDetail(detail),
    };
  },
});
