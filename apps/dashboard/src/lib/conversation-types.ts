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

export type ConversationMetadata = {
  assignedToUserId: string | null,
  assignedToDisplayName: string | null,
  tags: string[],
  firstResponseDueAt: string | null,
  firstResponseAt: string | null,
  nextResponseDueAt: string | null,
  lastCustomerReplyAt: string | null,
  lastAgentReplyAt: string | null,
};

export type ConversationSender = {
  type: ConversationSenderType,
  id: string | null,
  displayName: string | null,
  primaryEmail: string | null,
};

export type ConversationSummary = {
  conversationId: string,
  userId: string | null,
  teamId: string | null,
  userDisplayName: string | null,
  userPrimaryEmail: string | null,
  userProfileImageUrl: string | null,
  subject: string,
  status: ConversationStatus,
  priority: ConversationPriority,
  source: ConversationSource,
  lastMessageType: ConversationMessageType,
  preview: string | null,
  lastActivityAt: string,
  metadata: ConversationMetadata,
};

export type ConversationMessage = {
  id: string,
  conversationId: string,
  userId: string | null,
  teamId: string | null,
  subject: string,
  status: ConversationStatus,
  priority: ConversationPriority,
  source: ConversationSource,
  messageType: ConversationMessageType,
  body: string | null,
  attachments: unknown[],
  metadata: unknown | null,
  createdAt: string,
  sender: ConversationSender,
};

export type ConversationDetailResponse = {
  conversation: ConversationSummary,
  messages: ConversationMessage[],
};
