import type {
  SupportConversationDetailJson,
  SupportConversationMessageJson,
  SupportConversationSummaryJson,
} from "@hexclave/shared/dist/interface/client-interface";

/** A support conversation the current user is taking part in. */
export type SupportConversation = {
  conversationId: string,
  subject: string,
  status: string,
  priority: string,
  source: string,
  lastMessageType: string,
  preview: string | null,
  lastActivityAt: string,
};

export type SupportConversationMessage = {
  id: string,
  body: string | null,
  messageType: string,
  createdAt: string,
  sender: {
    type: string,
    id: string | null,
    displayName: string | null,
    primaryEmail: string | null,
  },
};

export type SupportConversationDetail = {
  conversation: SupportConversation,
  messages: SupportConversationMessage[],
};

export function supportConversationFromJson(json: SupportConversationSummaryJson): SupportConversation {
  return {
    conversationId: json.conversation_id,
    subject: json.subject,
    status: json.status,
    priority: json.priority,
    source: json.source,
    lastMessageType: json.last_message_type,
    preview: json.preview,
    lastActivityAt: json.last_activity_at,
  };
}

export function supportMessageFromJson(json: SupportConversationMessageJson): SupportConversationMessage {
  return {
    id: json.id,
    body: json.body,
    messageType: json.message_type,
    createdAt: json.created_at,
    sender: {
      type: json.sender.type,
      id: json.sender.id,
      displayName: json.sender.display_name,
      primaryEmail: json.sender.primary_email,
    },
  };
}

export function supportConversationDetailFromJson(json: SupportConversationDetailJson): SupportConversationDetail {
  return {
    conversation: supportConversationFromJson(json.conversation),
    messages: json.messages.map(supportMessageFromJson),
  };
}
