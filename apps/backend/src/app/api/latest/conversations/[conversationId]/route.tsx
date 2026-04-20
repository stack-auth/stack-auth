import {
  appendConversationMessage,
  getConversationDetail,
} from "@/lib/conversations";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import {
  adaptSchema,
  yupArray,
  yupMixed,
  yupNumber,
  yupObject,
  yupString,
} from "@stackframe/stack-shared/dist/schema-fields";

const authenticatedUserAuthSchema = yupObject({
  type: yupString().oneOf(["client"]).defined(),
  tenancy: adaptSchema.defined(),
  user: adaptSchema.defined(),
}).defined();

const routeParamsSchema = yupObject({
  conversationId: yupString().uuid().defined(),
}).defined();

const publicConversationMetadataSchema = yupObject({
  assigned_to_user_id: yupString().nullable().defined(),
  assigned_to_display_name: yupString().nullable().defined(),
  tags: yupArray(yupString().defined()).defined(),
  first_response_due_at: yupString().nullable().defined(),
  first_response_at: yupString().nullable().defined(),
  next_response_due_at: yupString().nullable().defined(),
  last_customer_reply_at: yupString().nullable().defined(),
  last_agent_reply_at: yupString().nullable().defined(),
}).defined();

const publicConversationSummarySchema = yupObject({
  conversation_id: yupString().uuid().defined(),
  user_id: yupString().uuid().nullable().defined(),
  team_id: yupString().uuid().nullable().defined(),
  user_display_name: yupString().nullable().defined(),
  user_primary_email: yupString().nullable().defined(),
  user_profile_image_url: yupString().nullable().defined(),
  subject: yupString().defined(),
  status: yupString().defined(),
  priority: yupString().defined(),
  source: yupString().defined(),
  last_message_type: yupString().defined(),
  preview: yupString().nullable().defined(),
  last_activity_at: yupString().defined(),
  metadata: publicConversationMetadataSchema,
}).defined();

const publicConversationMessageSchema = yupObject({
  id: yupString().uuid().defined(),
  conversation_id: yupString().uuid().defined(),
  user_id: yupString().uuid().nullable().defined(),
  team_id: yupString().uuid().nullable().defined(),
  subject: yupString().defined(),
  status: yupString().defined(),
  priority: yupString().defined(),
  source: yupString().defined(),
  message_type: yupString().defined(),
  body: yupString().nullable().defined(),
  attachments: yupArray(yupMixed().defined()).defined(),
  metadata: yupMixed().nullable().defined(),
  created_at: yupString().defined(),
  sender: yupObject({
    type: yupString().defined(),
    id: yupString().nullable().defined(),
    display_name: yupString().nullable().defined(),
    primary_email: yupString().nullable().defined(),
  }).defined(),
}).defined();

const publicConversationDetailResponseSchema = yupObject({
  conversation: publicConversationSummarySchema,
  messages: yupArray(publicConversationMessageSchema).defined(),
}).defined();

function toPublicConversationDetail(detail: Awaited<ReturnType<typeof getConversationDetail>>) {
  return {
    conversation: {
      conversation_id: detail.conversation.conversationId,
      user_id: detail.conversation.userId,
      team_id: detail.conversation.teamId,
      user_display_name: detail.conversation.userDisplayName,
      user_primary_email: detail.conversation.userPrimaryEmail,
      user_profile_image_url: detail.conversation.userProfileImageUrl,
      subject: detail.conversation.subject,
      status: detail.conversation.status,
      priority: detail.conversation.priority,
      source: detail.conversation.source,
      last_message_type: detail.conversation.lastMessageType,
      preview: detail.conversation.preview,
      last_activity_at: detail.conversation.lastActivityAt,
      metadata: {
        assigned_to_user_id: detail.conversation.metadata.assignedToUserId,
        assigned_to_display_name: detail.conversation.metadata.assignedToDisplayName,
        tags: detail.conversation.metadata.tags,
        first_response_due_at: detail.conversation.metadata.firstResponseDueAt,
        first_response_at: detail.conversation.metadata.firstResponseAt,
        next_response_due_at: detail.conversation.metadata.nextResponseDueAt,
        last_customer_reply_at: detail.conversation.metadata.lastCustomerReplyAt,
        last_agent_reply_at: detail.conversation.metadata.lastAgentReplyAt,
      },
    },
    messages: detail.messages.map((message) => ({
      id: message.id,
      conversation_id: message.conversationId,
      user_id: message.userId,
      team_id: message.teamId,
      subject: message.subject,
      status: message.status,
      priority: message.priority,
      source: message.source,
      message_type: message.messageType,
      body: message.body,
      attachments: message.attachments,
      metadata: message.metadata,
      created_at: message.createdAt,
      sender: {
        type: message.sender.type,
        id: message.sender.id,
        display_name: message.sender.displayName,
        primary_email: message.sender.primaryEmail,
      },
    })),
  };
}

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get a conversation for the current user",
    description: "Get conversation detail visible to the currently authenticated user",
    tags: ["Conversations"],
  },
  request: yupObject({
    auth: authenticatedUserAuthSchema,
    params: routeParamsSchema,
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
    params: routeParamsSchema,
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
