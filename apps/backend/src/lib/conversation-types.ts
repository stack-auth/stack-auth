import * as yup from "yup";
import { yupArray, yupMixed, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const conversationStatusValues = ["open", "pending", "closed"] as const;
export type ConversationStatus = (typeof conversationStatusValues)[number];

export const conversationPriorityValues = ["low", "normal", "high", "urgent"] as const;
export type ConversationPriority = (typeof conversationPriorityValues)[number];

export const conversationSourceValues = ["manual", "chat", "email", "api"] as const;
export type ConversationSource = (typeof conversationSourceValues)[number];

export const conversationSenderTypeValues = ["user", "agent", "system"] as const;
export type ConversationSenderType = (typeof conversationSenderTypeValues)[number];

export const conversationMessageTypeValues = ["message", "internal-note", "status-change"] as const;
export type ConversationMessageType = (typeof conversationMessageTypeValues)[number];

export const conversationMetadataSchema = yupObject({
  assignedToUserId: yupString().nullable().defined(),
  assignedToDisplayName: yupString().nullable().defined(),
  tags: yupArray(yupString().defined()).defined(),
  firstResponseDueAt: yupString().nullable().defined(),
  firstResponseAt: yupString().nullable().defined(),
  nextResponseDueAt: yupString().nullable().defined(),
  lastCustomerReplyAt: yupString().nullable().defined(),
  lastAgentReplyAt: yupString().nullable().defined(),
});

export const conversationSenderSchema = yupObject({
  type: yupString().oneOf(conversationSenderTypeValues).defined(),
  id: yupString().nullable().defined(),
  displayName: yupString().nullable().defined(),
  primaryEmail: yupString().nullable().defined(),
});

export const conversationSummarySchema = yupObject({
  conversationId: yupString().uuid().defined(),
  userId: yupString().uuid().nullable().defined(),
  teamId: yupString().uuid().nullable().defined(),
  userDisplayName: yupString().nullable().defined(),
  userPrimaryEmail: yupString().nullable().defined(),
  userProfileImageUrl: yupString().nullable().defined(),
  subject: yupString().defined(),
  status: yupString().oneOf(conversationStatusValues).defined(),
  priority: yupString().oneOf(conversationPriorityValues).defined(),
  source: yupString().oneOf(conversationSourceValues).defined(),
  lastMessageType: yupString().oneOf(conversationMessageTypeValues).defined(),
  preview: yupString().nullable().defined(),
  lastActivityAt: yupString().defined(),
  metadata: conversationMetadataSchema.defined(),
});

export const conversationMessageSchema = yupObject({
  id: yupString().uuid().defined(),
  conversationId: yupString().uuid().defined(),
  userId: yupString().uuid().nullable().defined(),
  teamId: yupString().uuid().nullable().defined(),
  subject: yupString().defined(),
  status: yupString().oneOf(conversationStatusValues).defined(),
  priority: yupString().oneOf(conversationPriorityValues).defined(),
  source: yupString().oneOf(conversationSourceValues).defined(),
  messageType: yupString().oneOf(conversationMessageTypeValues).defined(),
  body: yupString().nullable().defined(),
  attachments: yupArray(yupMixed().defined()).defined(),
  metadata: yupMixed().nullable().defined(),
  createdAt: yupString().defined(),
  sender: conversationSenderSchema.defined(),
});

export const conversationListResponseSchema = yupObject({
  conversations: yupArray(conversationSummarySchema.defined()).defined(),
});

export const conversationDetailResponseSchema = yupObject({
  conversation: conversationSummarySchema.defined(),
  messages: yupArray(conversationMessageSchema.defined()).defined(),
});

export type ConversationMetadata = yup.InferType<typeof conversationMetadataSchema>;
export type ConversationSender = yup.InferType<typeof conversationSenderSchema>;
export type ConversationSummary = yup.InferType<typeof conversationSummarySchema>;
export type ConversationMessage = yup.InferType<typeof conversationMessageSchema>;
export type ConversationListResponse = yup.InferType<typeof conversationListResponseSchema>;
export type ConversationDetailResponse = yup.InferType<typeof conversationDetailResponseSchema>;
