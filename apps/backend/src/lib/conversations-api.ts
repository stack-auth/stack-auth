import { getConversationDetail, listConversationSummaries } from "@/lib/conversations";
import {
  adaptSchema,
  yupArray,
  yupMixed,
  yupObject,
  yupString,
} from "@stackframe/stack-shared/dist/schema-fields";

/**
 * Auth schema shared by internal dashboard conversation routes. Only signed-in
 * internal-project users are permitted. Keep the auth shape consistent so all
 * conversation routes enforce the same access model.
 */
export const internalDashboardAuthSchema = yupObject({
  type: adaptSchema,
  user: adaptSchema.defined(),
  project: yupObject({
    id: yupString().oneOf(["internal"]).defined(),
  }).defined(),
}).defined();

/**
 * Auth schema shared by the public user-facing conversation routes. Requires
 * a signed-in client user scoped to a tenancy.
 */
export const authenticatedUserAuthSchema = yupObject({
  type: yupString().oneOf(["client"]).defined(),
  tenancy: adaptSchema.defined(),
  user: adaptSchema.defined(),
}).defined();

/**
 * `[conversationId]` URL param schema — shared by every conversation sub-route.
 */
export const conversationIdRouteParamsSchema = yupObject({
  conversationId: yupString().uuid().defined(),
}).defined();

/**
 * Public (snake_case) response schemas. These are what leaves the API boundary
 * to external consumers; the internal camelCase shapes live in
 * `@stackframe/stack-shared/dist/interface/conversations`.
 */
export const publicConversationMetadataSchema = yupObject({
  assigned_to_user_id: yupString().nullable().defined(),
  assigned_to_display_name: yupString().nullable().defined(),
  tags: yupArray(yupString().defined()).defined(),
  first_response_due_at: yupString().nullable().defined(),
  first_response_at: yupString().nullable().defined(),
  next_response_due_at: yupString().nullable().defined(),
  last_customer_reply_at: yupString().nullable().defined(),
  last_agent_reply_at: yupString().nullable().defined(),
}).defined();

export const publicConversationSummarySchema = yupObject({
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

export const publicConversationListResponseSchema = yupObject({
  conversations: yupArray(publicConversationSummarySchema).defined(),
}).defined();

export const publicConversationMessageSchema = yupObject({
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

export const publicConversationDetailResponseSchema = yupObject({
  conversation: publicConversationSummarySchema,
  messages: yupArray(publicConversationMessageSchema).defined(),
}).defined();

type ConversationSummaryInput = Awaited<ReturnType<typeof listConversationSummaries>>[number];
type ConversationDetailInput = Awaited<ReturnType<typeof getConversationDetail>>;

export function toPublicConversationSummary(conversation: ConversationSummaryInput) {
  return {
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
  };
}

export function toPublicConversationDetail(detail: ConversationDetailInput) {
  return {
    conversation: toPublicConversationSummary(detail.conversation),
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
