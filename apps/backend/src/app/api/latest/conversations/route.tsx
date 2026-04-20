import {
  createConversation,
  listConversationSummaries,
} from "@/lib/conversations";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import {
  adaptSchema,
  yupArray,
  yupNumber,
  yupObject,
  yupString,
} from "@stackframe/stack-shared/dist/schema-fields";

const authenticatedUserAuthSchema = yupObject({
  type: yupString().oneOf(["client"]).defined(),
  tenancy: adaptSchema.defined(),
  user: adaptSchema.defined(),
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

const publicConversationListResponseSchema = yupObject({
  conversations: yupArray(publicConversationSummarySchema).defined(),
}).defined();

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
        conversations: conversations.map((conversation) => ({
          conversation_id: conversation.conversationId,
          user_id: conversation.userId,
          team_id: conversation.teamId,
          user_display_name: conversation.userDisplayName,
          user_primary_email: conversation.userPrimaryEmail,
          user_profile_image_url: conversation.userProfileImageUrl,
          subject: conversation.subject,
          status: conversation.status,
          priority: conversation.priority,
          source: conversation.source,
          last_message_type: conversation.lastMessageType,
          preview: conversation.preview,
          last_activity_at: conversation.lastActivityAt,
          metadata: {
            assigned_to_user_id: conversation.metadata.assignedToUserId,
            assigned_to_display_name: conversation.metadata.assignedToDisplayName,
            tags: conversation.metadata.tags,
            first_response_due_at: conversation.metadata.firstResponseDueAt,
            first_response_at: conversation.metadata.firstResponseAt,
            next_response_due_at: conversation.metadata.nextResponseDueAt,
            last_customer_reply_at: conversation.metadata.lastCustomerReplyAt,
            last_agent_reply_at: conversation.metadata.lastAgentReplyAt,
          },
        })),
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
