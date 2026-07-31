import type { CommsConversationsCrud } from "@hexclave/shared/dist/interface/crud/comms-conversations";
import type { CommsMessagesCrud } from "@hexclave/shared/dist/interface/crud/comms-messages";
import type {
  CommsDelivery as CommsDeliveryCrud,
  CommsDeliveryAttempt as CommsDeliveryAttemptCrud,
  CommsDeliveryAttemptCreate as CommsDeliveryAttemptCreateCrud,
  CommsDeliveryCreate as CommsDeliveryCreateCrud,
  CommsDeliveryStatus,
  CommsDeliveryStatusUpdate as CommsDeliveryStatusUpdateCrud,
  CommsMessageAttachment as CommsMessageAttachmentCrud,
  CommsMessageAttachmentWrite as CommsMessageAttachmentCreateCrud,
  CommsMessageIngest as CommsMessageCreateCrud,
  CommsMessageParticipant as CommsMessageParticipantCrud,
  CommsMessageParticipantWrite as CommsMessageParticipantCreateCrud,
  CommsMessagePayload as CommsMessagePayloadCrud,
  CommsMessageRelation as CommsMessageRelationCrud,
  CommsMessageRelationWrite as CommsMessageRelationCreateCrud,
} from "@hexclave/shared/dist/interface/comms";
import type { ReadonlyJson } from "@hexclave/shared/dist/utils/json";
import type { ServerCommunicationChannelCreateOptions } from "../contacts";

export type CommsMessagePayload =
  | {
    type: "email",
    version: 1,
    subject: string | null,
    textBody: string | null,
    htmlBody: string | null,
    ampHtmlBody: string | null,
    headers: { name: string, value: string }[],
  }
  | {
    type: "slack",
    version: 1,
    text: string,
    blocks: ReadonlyJson,
    workspaceId: string,
    channelId: string,
    threadId: string | null,
  }
  | {
    type: "discord",
    version: 1,
    content: string,
    embeds: NonNullable<ReadonlyJson>[],
    guildId: string | null,
    channelId: string,
    threadId: string | null,
  }
  | {
    type: "push",
    version: 1,
    title: string | null,
    body: string,
    data: ReadonlyJson,
  };

export type ServerCommsMessageParticipant = {
  id: string,
  role: CommsMessageParticipantCrud["role"],
  position: number,
  contactId: string | null,
  contactChannelId: string | null,
  addressSnapshot: string,
  displayNameSnapshot: string | null,
};

export type ServerCommsMessageParticipantCreateOptions = {
  role: CommsMessageParticipantCreateCrud["role"],
  position?: number,
  contactId?: string | null,
  contactChannelId?: string | null,
  contactChannel?: ServerCommunicationChannelCreateOptions,
  addressSnapshot?: string,
  displayNameSnapshot?: string | null,
};

export type ServerCommsMessageAttachment = {
  id: string,
  filename: string | null,
  contentType: string | null,
  sizeBytes: number | null,
  contentId: string | null,
  isInline: boolean,
  storageKey: string | null,
  metadata: ReadonlyJson,
};

export type ServerCommsMessageAttachmentCreateOptions = {
  filename?: string | null,
  contentType?: string | null,
  sizeBytes?: number | null,
  contentId?: string | null,
  isInline?: boolean,
  storageKey?: string | null,
  metadata?: ReadonlyJson,
};

export type ServerCommsMessageRelation = {
  id: string,
  type: CommsMessageRelationCrud["relation_type"],
  toMessageId: string | null,
  externalMessageId: string | null,
  position: number,
};

export type ServerCommsMessageRelationCreateOptions = {
  type: CommsMessageRelationCreateCrud["relation_type"],
  toMessageId?: string | null,
  externalMessageId?: string | null,
  position?: number,
};

export type ServerCommsMessage = {
  id: string,
  conversationId: string,
  direction: "inbound" | "outbound",
  adapterKey: string,
  externalMessageId: string | null,
  externalThreadId: string | null,
  replyToMessageId: string | null,
  occurredAt: Date,
  ingestedAt: Date,
  payload: CommsMessagePayload,
  participants: ServerCommsMessageParticipant[],
  attachments: ServerCommsMessageAttachment[],
  relations: ServerCommsMessageRelation[],
  rawBlobKey: string | null,

  listDeliveries(): Promise<ServerCommsDelivery[]>,
  createDelivery(data: ServerCommsDeliveryCreateOptions): Promise<ServerCommsDelivery>,
};

export type ServerCommsMessageCreateOptions = {
  direction: "inbound" | "outbound",
  adapterKey: string,
  externalMessageId?: string | null,
  externalThreadId?: string | null,
  replyToMessageId?: string | null,
  occurredAt: Date,
  payload: CommsMessagePayload,
  participants: ServerCommsMessageParticipantCreateOptions[],
  attachments?: ServerCommsMessageAttachmentCreateOptions[],
  relations?: ServerCommsMessageRelationCreateOptions[],
  rawBlobKey?: string | null,
  conversationId?: string | null,
};

export type ServerCommsMessageListOptions = {
  conversationId?: string,
  cursor?: string,
  limit?: number,
};

export type ServerCommsConversation = {
  id: string,
  title: string | null,
  mergedIntoConversationId: string | null,
  mergedAt: Date | null,
  firstMessageAt: Date | null,
  lastMessageAt: Date | null,
  createdAt: Date,
  updatedAt: Date,

  update(data: ServerCommsConversationUpdateOptions): Promise<void>,
  mergeInto(options: ServerCommsConversationMergeOptions): Promise<ServerCommsConversationOperationResult>,
  split(options: ServerCommsConversationSplitOptions): Promise<ServerCommsConversationOperationResult>,
  reassignMessages(options: ServerCommsConversationReassignOptions): Promise<ServerCommsConversationOperationResult>,
  listMessages(options?: Omit<ServerCommsMessageListOptions, "conversationId">): Promise<ServerCommsMessage[] & { nextCursor: string | null }>,
};

export type ServerCommsConversationCreateOptions = {
  title?: string | null,
};

export type ServerCommsConversationUpdateOptions = {
  title?: string | null,
};

export type ServerCommsConversationListOptions = {
  cursor?: string,
  limit?: number,
  includeMerged?: boolean,
};

export type ServerCommsConversationMergeOptions = {
  targetConversationId: string,
  idempotencyKey: string,
  actorUserId?: string | null,
  reason?: string | null,
  metadata?: ReadonlyJson,
};

export type ServerCommsConversationSplitOptions = {
  messageIds: string[],
  idempotencyKey: string,
  title?: string | null,
  actorUserId?: string | null,
  reason?: string | null,
  metadata?: ReadonlyJson,
};

export type ServerCommsConversationReassignOptions = {
  messageIds: string[],
  idempotencyKey: string,
  actorUserId?: string | null,
  reason?: string | null,
  metadata?: ReadonlyJson,
};

export type ServerCommsConversationOperationResult = {
  operationId: string,
  replayed: boolean,
  conversation: ServerCommsConversation,
};

export type ServerCommsDeliveryAttempt = {
  id: string,
  attemptNumber: number,
  outcome: CommsDeliveryAttemptCrud["outcome"],
  attemptedAt: Date,
  finishedAt: Date | null,
  providerResponse: ReadonlyJson,
  errorPublic: string | null,
  errorInternal: string | null,
};

export type ServerCommsDelivery = {
  id: string,
  messageId: string,
  participantId: string | null,
  addressSnapshot: string,
  status: CommsDeliveryStatus,
  providerMessageId: string | null,
  skippedReason: string | null,
  lastErrorPublic: string | null,
  lastErrorInternal: string | null,
  sentAt: Date | null,
  deliveredAt: Date | null,
  bouncedAt: Date | null,
  failedAt: Date | null,
  createdAt: Date,
  updatedAt: Date,
  attempts: ServerCommsDeliveryAttempt[],

  updateStatus(data: ServerCommsDeliveryStatusUpdateOptions): Promise<void>,
  recordAttempt(data: ServerCommsDeliveryAttemptCreateOptions): Promise<ServerCommsDeliveryAttempt>,
};

export type ServerCommsDeliveryCreateOptions = {
  addressSnapshot: string,
  participantId?: string | null,
  status?: CommsDeliveryStatus,
};

export type ServerCommsDeliveryStatusUpdateOptions = {
  status: CommsDeliveryStatus,
  providerMessageId?: string | null,
  skippedReason?: string | null,
  lastErrorPublic?: string | null,
  lastErrorInternal?: string | null,
};

export type ServerCommsDeliveryAttemptCreateOptions = {
  outcome: CommsDeliveryAttemptCrud["outcome"],
  providerResponse?: ReadonlyJson,
  errorPublic?: string | null,
  errorInternal?: string | null,
  finishedAt?: Date | null,
  status?: CommsDeliveryStatus,
  providerMessageId?: string | null,
};

function messagePayloadToCrud(payload: CommsMessagePayload): CommsMessagePayloadCrud {
  switch (payload.type) {
    case "email": {
      return {
        type: "email",
        version: 1,
        subject: payload.subject,
        text_body: payload.textBody,
        html_body: payload.htmlBody,
        amp_html_body: payload.ampHtmlBody,
        headers: payload.headers,
      };
    }
    case "slack": {
      return {
        type: "slack",
        version: 1,
        text: payload.text,
        blocks: payload.blocks,
        workspace_id: payload.workspaceId,
        channel_id: payload.channelId,
        thread_id: payload.threadId,
      };
    }
    case "discord": {
      return {
        type: "discord",
        version: 1,
        content: payload.content,
        embeds: payload.embeds,
        guild_id: payload.guildId,
        channel_id: payload.channelId,
        thread_id: payload.threadId,
      };
    }
    case "push": {
      return {
        type: "push",
        version: 1,
        title: payload.title,
        body: payload.body,
        data: payload.data,
      };
    }
  }
}

function messagePayloadFromCrud(payload: CommsMessagePayloadCrud): CommsMessagePayload {
  switch (payload.type) {
    case "email": {
      return {
        type: "email",
        version: 1,
        subject: payload.subject,
        textBody: payload.text_body,
        htmlBody: payload.html_body,
        ampHtmlBody: payload.amp_html_body,
        headers: payload.headers,
      };
    }
    case "slack": {
      return {
        type: "slack",
        version: 1,
        text: payload.text,
        blocks: payload.blocks,
        workspaceId: payload.workspace_id,
        channelId: payload.channel_id,
        threadId: payload.thread_id,
      };
    }
    case "discord": {
      return {
        type: "discord",
        version: 1,
        content: payload.content,
        embeds: payload.embeds,
        guildId: payload.guild_id,
        channelId: payload.channel_id,
        threadId: payload.thread_id,
      };
    }
    case "push": {
      return {
        type: "push",
        version: 1,
        title: payload.title,
        body: payload.body,
        data: payload.data,
      };
    }
  }
}

export function serverCommsMessageCreateOptionsToCrud(
  options: ServerCommsMessageCreateOptions,
  contactChannelToCrud: (channel: ServerCommunicationChannelCreateOptions) => CommsMessageParticipantCreateCrud["channel"],
): CommsMessageCreateCrud {
  return {
    direction: options.direction,
    adapter_key: options.adapterKey,
    external_message_id: options.externalMessageId,
    external_thread_id: options.externalThreadId,
    reply_to_message_id: options.replyToMessageId,
    occurred_at_millis: options.occurredAt.getTime(),
    payload: messagePayloadToCrud(options.payload),
    participants: options.participants.map((participant) => ({
      role: participant.role,
      position: participant.position,
      contact_id: participant.contactId,
      contact_channel_id: participant.contactChannelId,
      channel: participant.contactChannel == null ? undefined : contactChannelToCrud(participant.contactChannel),
      address_snapshot: participant.addressSnapshot,
      display_name_snapshot: participant.displayNameSnapshot,
    })),
    attachments: options.attachments?.map((attachment): CommsMessageAttachmentCreateCrud => ({
      filename: attachment.filename,
      content_type: attachment.contentType,
      size_bytes: attachment.sizeBytes,
      content_id: attachment.contentId,
      is_inline: attachment.isInline,
      storage_key: attachment.storageKey,
      metadata: attachment.metadata,
    })),
    relations: options.relations?.map((relation): CommsMessageRelationCreateCrud => ({
      relation_type: relation.type,
      to_message_id: relation.toMessageId,
      external_message_id: relation.externalMessageId,
      position: relation.position,
    })),
    raw_blob_key: options.rawBlobKey,
    conversation_id: options.conversationId,
  };
}

export function serverCommsMessageFromCrud(
  crud: CommsMessagesCrud["Server"]["Read"],
  methods: Pick<ServerCommsMessage, "listDeliveries" | "createDelivery">,
): ServerCommsMessage {
  return {
    id: crud.id,
    conversationId: crud.conversation_id,
    direction: crud.direction,
    adapterKey: crud.adapter_key,
    externalMessageId: crud.external_message_id,
    externalThreadId: crud.external_thread_id,
    replyToMessageId: crud.reply_to_message_id,
    occurredAt: new Date(crud.occurred_at_millis),
    ingestedAt: new Date(crud.ingested_at_millis),
    payload: messagePayloadFromCrud(crud.payload),
    participants: crud.participants.map((participant) => ({
      id: participant.id,
      role: participant.role,
      position: participant.position,
      contactId: participant.contact_id,
      contactChannelId: participant.contact_channel_id,
      addressSnapshot: participant.address_snapshot,
      displayNameSnapshot: participant.display_name_snapshot,
    })),
    attachments: crud.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.content_type,
      sizeBytes: attachment.size_bytes,
      contentId: attachment.content_id,
      isInline: attachment.is_inline,
      storageKey: attachment.storage_key,
      metadata: attachment.metadata,
    })),
    relations: crud.relations.map((relation) => ({
      id: relation.id,
      type: relation.relation_type,
      toMessageId: relation.to_message_id,
      externalMessageId: relation.external_message_id,
      position: relation.position,
    })),
    rawBlobKey: crud.raw_blob_key,
    ...methods,
  };
}

export function serverCommsConversationCreateOptionsToCrud(
  options: ServerCommsConversationCreateOptions,
): CommsConversationsCrud["Server"]["Create"] {
  return {
    title: options.title,
  };
}

export function serverCommsConversationUpdateOptionsToCrud(
  options: ServerCommsConversationUpdateOptions,
): CommsConversationsCrud["Server"]["Update"] {
  return {
    title: options.title,
  };
}

export function serverCommsConversationFromCrud(
  crud: CommsConversationsCrud["Server"]["Read"],
  methods: Pick<
    ServerCommsConversation,
    "update" | "mergeInto" | "split" | "reassignMessages" | "listMessages"
  >,
): ServerCommsConversation {
  return {
    id: crud.id,
    title: crud.title,
    mergedIntoConversationId: crud.merged_into_conversation_id,
    mergedAt: crud.merged_at_millis == null ? null : new Date(crud.merged_at_millis),
    firstMessageAt: crud.first_message_at_millis == null ? null : new Date(crud.first_message_at_millis),
    lastMessageAt: crud.last_message_at_millis == null ? null : new Date(crud.last_message_at_millis),
    createdAt: new Date(crud.created_at_millis),
    updatedAt: new Date(crud.updated_at_millis),
    update: methods.update,
    mergeInto: methods.mergeInto,
    split: methods.split,
    reassignMessages: methods.reassignMessages,
    listMessages: methods.listMessages,
  };
}

export function serverCommsDeliveryCreateOptionsToCrud(
  options: ServerCommsDeliveryCreateOptions,
): CommsDeliveryCreateCrud {
  return {
    address_snapshot: options.addressSnapshot,
    participant_id: options.participantId,
    status: options.status,
  };
}

export function serverCommsDeliveryStatusUpdateOptionsToCrud(
  options: ServerCommsDeliveryStatusUpdateOptions,
): CommsDeliveryStatusUpdateCrud {
  return {
    status: options.status,
    provider_message_id: options.providerMessageId,
    skipped_reason: options.skippedReason,
    last_error_public: options.lastErrorPublic,
    last_error_internal: options.lastErrorInternal,
  };
}

export function serverCommsDeliveryAttemptCreateOptionsToCrud(
  options: ServerCommsDeliveryAttemptCreateOptions,
): CommsDeliveryAttemptCreateCrud {
  return {
    outcome: options.outcome,
    provider_response: options.providerResponse,
    error_public: options.errorPublic,
    error_internal: options.errorInternal,
    finished_at_millis: options.finishedAt === undefined
      ? undefined
      : options.finishedAt?.getTime() ?? null,
    status: options.status,
    provider_message_id: options.providerMessageId,
  };
}

export function serverCommsDeliveryAttemptFromCrud(
  crud: CommsDeliveryAttemptCrud,
): ServerCommsDeliveryAttempt {
  return {
    id: crud.id,
    attemptNumber: crud.attempt_number,
    outcome: crud.outcome,
    attemptedAt: new Date(crud.attempted_at_millis),
    finishedAt: crud.finished_at_millis == null ? null : new Date(crud.finished_at_millis),
    providerResponse: crud.provider_response,
    errorPublic: crud.error_public,
    errorInternal: crud.error_internal,
  };
}

export function serverCommsDeliveryFromCrud(
  crud: CommsDeliveryCrud,
  methods: Pick<ServerCommsDelivery, "updateStatus" | "recordAttempt">,
): ServerCommsDelivery {
  return {
    id: crud.id,
    messageId: crud.message_id,
    participantId: crud.participant_id,
    addressSnapshot: crud.address_snapshot,
    status: crud.status,
    providerMessageId: crud.provider_message_id,
    skippedReason: crud.skipped_reason,
    lastErrorPublic: crud.last_error_public,
    lastErrorInternal: crud.last_error_internal,
    sentAt: crud.sent_at_millis == null ? null : new Date(crud.sent_at_millis),
    deliveredAt: crud.delivered_at_millis == null ? null : new Date(crud.delivered_at_millis),
    bouncedAt: crud.bounced_at_millis == null ? null : new Date(crud.bounced_at_millis),
    failedAt: crud.failed_at_millis == null ? null : new Date(crud.failed_at_millis),
    createdAt: new Date(crud.created_at_millis),
    updatedAt: new Date(crud.updated_at_millis),
    attempts: crud.attempts?.map(serverCommsDeliveryAttemptFromCrud) ?? [],
    ...methods,
  };
}
