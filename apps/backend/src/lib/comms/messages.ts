import { Prisma, type CommsMessage as CommsMessageRow } from "@/generated/prisma/client";
import type { PrismaTransaction } from "@/lib/types";
import {
  commsMessageIngestSchema,
  commsMessagePayloadDiscordSchema,
  commsMessagePayloadEmailSchema,
  commsMessagePayloadPushSchema,
  commsMessagePayloadSlackSchema,
  type CommsMessage,
  type CommsMessageIngest,
  type CommsMessagePayload,
} from "@hexclave/shared/dist/interface/comms";
import { HexclaveAssertionError, StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";
import { chooseConversationForMessage } from "./assignment";
import {
  contactChannelTypeToApi,
  normalizeContactChannelWrite,
} from "./contact-channel-types";
import { resolveContactForIdentity } from "./contacts";
import { operationRequestFingerprint } from "./operation-requests";

type MessageWithRelations = CommsMessageRow & {
  participants: Array<{
    id: string,
    role: string,
    position: number,
    contactId: string | null,
    contactChannelId: string | null,
    addressSnapshot: string,
    displayNameSnapshot: string | null,
  }>,
  attachments: Array<{
    id: string,
    filename: string | null,
    contentType: string | null,
    sizeBytes: number | null,
    contentId: string | null,
    isInline: boolean,
    storageKey: string | null,
    metadata: Prisma.JsonValue | null,
  }>,
  relationsFrom: Array<{
    id: string,
    relationType: string,
    toMessageId: string | null,
    externalMessageId: string | null,
    position: number,
  }>,
};

const messageInclude = {
  participants: {
    orderBy: [{ role: "asc" as const }, { position: "asc" as const }],
  },
  attachments: {
    orderBy: { id: "asc" as const },
  },
  relationsFrom: {
    orderBy: [{ position: "asc" as const }, { id: "asc" as const }],
  },
};

function parsePayload(payloadType: string, payloadVersion: number, payload: Prisma.JsonValue): CommsMessagePayload {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HexclaveAssertionError("CommsMessage.payload must be a JSON object", { payload });
  }
  const withDiscriminator = {
    ...payload,
    type: payloadType,
    version: payloadVersion,
  };
  if (payloadType === "email") return commsMessagePayloadEmailSchema.validateSync(withDiscriminator, { stripUnknown: false });
  if (payloadType === "slack") return commsMessagePayloadSlackSchema.validateSync(withDiscriminator, { stripUnknown: false });
  if (payloadType === "discord") return commsMessagePayloadDiscordSchema.validateSync(withDiscriminator, { stripUnknown: false });
  if (payloadType === "push") return commsMessagePayloadPushSchema.validateSync(withDiscriminator, { stripUnknown: false });
  throw new HexclaveAssertionError("Unexpected CommsMessage.payloadType value from DB", { payloadType });
}

function parseMessageDirection(direction: string): CommsMessage["direction"] {
  if (direction === "inbound" || direction === "outbound") return direction;
  throw new HexclaveAssertionError("Unexpected CommsMessage.direction value from DB", { direction });
}

function parseParticipantRole(role: string): CommsMessage["participants"][number]["role"] {
  if (
    role === "author"
    || role === "from"
    || role === "sender"
    || role === "to"
    || role === "cc"
    || role === "bcc"
    || role === "reply-to"
    || role === "envelope-from"
    || role === "envelope-to"
    || role === "audience"
  ) return role;
  throw new HexclaveAssertionError("Unexpected CommsMessageParticipant.role value from DB", { role });
}

function parseRelationType(relationType: string): CommsMessage["relations"][number]["relation_type"] {
  if (
    relationType === "in-reply-to"
    || relationType === "references"
    || relationType === "quote"
    || relationType === "other"
  ) return relationType;
  throw new HexclaveAssertionError("Unexpected CommsMessageRelation.relationType value from DB", { relationType });
}

function payloadColumns(payload: CommsMessagePayload): {
  payloadType: string,
  payloadVersion: number,
  payload: Prisma.InputJsonValue,
} {
  const { type, version, ...rest } = payload;
  return {
    payloadType: type,
    payloadVersion: version,
    // Store channel-specific fields without duplicating type/version (those are columns).
    payload: rest,
  };
}

export function messageRowToApi(row: MessageWithRelations): CommsMessage {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    direction: parseMessageDirection(row.direction),
    adapter_key: row.adapterKey,
    external_message_id: row.externalMessageId,
    external_thread_id: row.externalThreadId,
    reply_to_message_id: row.replyToMessageId,
    occurred_at_millis: row.occurredAt.getTime(),
    ingested_at_millis: row.ingestedAt.getTime(),
    payload: parsePayload(row.payloadType, row.payloadVersion, row.payload),
    participants: row.participants.map((participant) => ({
      id: participant.id,
      role: parseParticipantRole(participant.role),
      position: participant.position,
      contact_id: participant.contactId,
      contact_channel_id: participant.contactChannelId,
      address_snapshot: participant.addressSnapshot,
      display_name_snapshot: participant.displayNameSnapshot,
    })),
    attachments: row.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      content_type: attachment.contentType,
      size_bytes: attachment.sizeBytes,
      content_id: attachment.contentId,
      is_inline: attachment.isInline,
      storage_key: attachment.storageKey,
      metadata: attachment.metadata,
    })),
    relations: row.relationsFrom.map((relation) => ({
      id: relation.id,
      relation_type: parseRelationType(relation.relationType),
      to_message_id: relation.toMessageId,
      external_message_id: relation.externalMessageId,
      position: relation.position,
    })),
    raw_blob_key: row.rawBlobKey,
  };
}

export async function getMessage(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    messageId: string,
  },
): Promise<CommsMessage | null> {
  const row = await tx.commsMessage.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.messageId,
      },
    },
    include: messageInclude,
  });
  return row == null ? null : messageRowToApi(row);
}

export async function listMessages(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    conversationId?: string,
    limit?: number,
    cursorOccurredAtMillis?: number,
    cursorId?: string,
  },
): Promise<{ messages: CommsMessage[], nextCursor: { occurred_at_millis: number, id: string } | null }> {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new StatusError(StatusError.BadRequest, "limit must be an integer between 1 and 200");
  }
  if ((options.cursorOccurredAtMillis == null) !== (options.cursorId == null)) {
    throw new StatusError(StatusError.BadRequest, "Message cursor timestamp and ID must be provided together");
  }
  const cursorOccurredAt = options.cursorOccurredAtMillis == null
    ? null
    : new Date(options.cursorOccurredAtMillis);
  if (cursorOccurredAt != null && Number.isNaN(cursorOccurredAt.getTime())) {
    throw new StatusError(StatusError.BadRequest, "Invalid message cursor timestamp");
  }

  const rows = await tx.commsMessage.findMany({
    where: {
      tenancyId: options.tenancyId,
      ...(options.conversationId == null ? {} : { conversationId: options.conversationId }),
      ...(options.cursorOccurredAtMillis != null && options.cursorId != null
        ? {
          OR: [
            { occurredAt: { gt: cursorOccurredAt ?? throwErr("Validated message cursor date is missing") } },
            {
              occurredAt: cursorOccurredAt ?? throwErr("Validated message cursor date is missing"),
              id: { gt: options.cursorId },
            },
          ],
        }
        : {}),
    },
    include: messageInclude,
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  });

  const page = rows.slice(0, limit);
  if (rows.length <= limit) {
    return { messages: page.map(messageRowToApi), nextCursor: null };
  }
  const last = page[page.length - 1]
    ?? throwErr("listMessagesForConversation page unexpectedly empty when hasMore is true");
  return {
    messages: page.map(messageRowToApi),
    nextCursor: {
      occurred_at_millis: last.occurredAt.getTime(),
      id: last.id,
    },
  };
}

export async function listMessagesForConversation(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    conversationId: string,
    limit?: number,
    cursorOccurredAtMillis?: number,
    cursorId?: string,
  },
): Promise<{ messages: CommsMessage[], nextCursor: { occurred_at_millis: number, id: string } | null }> {
  return await listMessages(tx, options);
}

async function resolveParticipant(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    participant: CommsMessageIngest["participants"][number],
    index: number,
  },
): Promise<{
  role: string,
  position: number,
  contactId: string | null,
  contactChannelId: string | null,
  addressSnapshot: string,
  displayNameSnapshot: string | null,
}> {
  const participant = options.participant;
  const position = participant.position ?? options.index;

  let contactId = participant.contact_id ?? null;
  let contactChannelId = participant.contact_channel_id ?? null;
  let addressSnapshot = participant.address_snapshot ?? null;

  if (participant.channel != null) {
    const normalized = normalizeContactChannelWrite(participant.channel);
    addressSnapshot ??= normalized.value;

    if (contactId == null || contactChannelId == null) {
      const resolved = await resolveContactForIdentity(tx, {
        tenancyId: options.tenancyId,
        type: contactChannelTypeToApi(normalized.prismaType),
        value: normalized.value,
        identityScope: normalized.identityScope,
      });
      if (resolved.contact != null) {
        contactId ??= resolved.contact.id;
        const matchingChannel = resolved.contact.channels.find((channel) =>
          channel.type === contactChannelTypeToApi(normalized.prismaType)
          && channel.value === normalized.value
          && (
            channel.type !== "slack"
            || channel.workspace_id === normalized.identityScope
          )
          && (
            channel.type !== "push"
            || `${channel.provider}:${channel.app_id}:${channel.environment}` === normalized.identityScope
          )
        );
        contactChannelId ??= matchingChannel?.id ?? null;
      }
    }
  }

  if (contactChannelId != null) {
    const referencedChannel = await tx.contactChannel.findUnique({
      where: {
        tenancyId_id: {
          tenancyId: options.tenancyId,
          id: contactChannelId,
        },
      },
      select: { contactId: true, value: true },
    });
    if (referencedChannel == null) {
      throw new StatusError(
        StatusError.BadRequest,
        `participants[${options.index}].contact_channel_id does not exist`,
      );
    }
    if (contactId != null && contactId !== referencedChannel.contactId) {
      throw new StatusError(
        StatusError.BadRequest,
        `participants[${options.index}] references a contact channel owned by a different contact`,
      );
    }
    contactId = referencedChannel.contactId;
    addressSnapshot ??= referencedChannel.value;
  } else if (contactId != null) {
    const referencedContact = await tx.contact.findUnique({
      where: {
        tenancyId_id: {
          tenancyId: options.tenancyId,
          id: contactId,
        },
      },
      select: { id: true },
    });
    if (referencedContact == null) {
      throw new StatusError(
        StatusError.BadRequest,
        `participants[${options.index}].contact_id does not exist`,
      );
    }
  }

  if (addressSnapshot == null || addressSnapshot === "") {
    throw new StatusError(
      StatusError.BadRequest,
      `participants[${options.index}] requires address_snapshot or channel`,
    );
  }

  return {
    role: participant.role,
    position,
    contactId,
    contactChannelId,
    addressSnapshot,
    displayNameSnapshot: participant.display_name_snapshot ?? null,
  };
}

/**
 * Idempotently ingests an immutable message.
 * Conversation assignment prefers reply-to, then external thread, else a new conversation.
 * Idempotency key is (adapterKey, externalMessageId) when externalMessageId is present.
 */
export async function ingestMessage(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    data: CommsMessageIngest | unknown,
  },
): Promise<{ message: CommsMessage, replayed: boolean }> {
  const data = await commsMessageIngestSchema.validate(options.data, {
    stripUnknown: false,
    context: { noUnknownPathPrefixes: [""] },
  });
  const ingestFingerprint = operationRequestFingerprint(data);

  if (data.external_message_id != null) {
    // Serialize duplicate deliveries before the read so concurrent retries replay
    // the committed winner instead of racing into the partial unique index.
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          ${`comms-message:${options.tenancyId}:${data.adapter_key}:${data.external_message_id}`},
          0
        )
      )
    `;
    const existing = await tx.commsMessage.findFirst({
      where: {
        tenancyId: options.tenancyId,
        adapterKey: data.adapter_key,
        externalMessageId: data.external_message_id,
      },
      include: messageInclude,
    });
    if (existing != null) {
      if (existing.ingestFingerprint !== ingestFingerprint) {
        throw new StatusError(
          StatusError.Conflict,
          "external_message_id was already ingested with different message content",
        );
      }
      return { message: messageRowToApi(existing), replayed: true };
    }
  }

  const resolvedParticipants = [];
  for (let index = 0; index < data.participants.length; index++) {
    const participant = data.participants[index] ?? throwErr("participant missing at index", { index });
    resolvedParticipants.push(await resolveParticipant(tx, {
      tenancyId: options.tenancyId,
      participant,
      index,
    }));
  }
  const participantPositions = new Set<string>();
  for (const participant of resolvedParticipants) {
    const key = `${participant.role}\0${participant.position}`;
    if (participantPositions.has(key)) {
      throw new StatusError(
        StatusError.BadRequest,
        `participants contains duplicate role/position pair ${participant.role}/${participant.position}`,
      );
    }
    participantPositions.add(key);
  }

  const participantContactIds = [...new Set(
    resolvedParticipants
      .map((p) => p.contactId)
      .filter((id): id is string => id != null),
  )];

  let conversationId: string;
  let assignmentReason: "reply" | "external-thread" | "rules" | "ai" | "manual";
  let assignmentConfidence: number | null;

  if (data.conversation_id != null) {
    if (data.reply_to_message_id != null) {
      const replyTo = await tx.commsMessage.findUnique({
        where: {
          tenancyId_id: {
            tenancyId: options.tenancyId,
            id: data.reply_to_message_id,
          },
        },
        select: { id: true },
      });
      if (replyTo == null) {
        throw new StatusError(StatusError.BadRequest, "reply_to_message_id does not exist");
      }
    }
    const explicit = await tx.commsConversation.findUnique({
      where: {
        tenancyId_id: {
          tenancyId: options.tenancyId,
          id: data.conversation_id,
        },
      },
      select: { id: true, mergedIntoConversationId: true },
    });
    if (explicit == null) {
      throw new StatusError(StatusError.BadRequest, "conversation_id does not exist");
    }
    conversationId = explicit.mergedIntoConversationId ?? explicit.id;
    assignmentReason = "manual";
    assignmentConfidence = 1;
  } else {
    const choice = await chooseConversationForMessage(tx, {
      tenancyId: options.tenancyId,
      replyToMessageId: data.reply_to_message_id ?? null,
      externalThreadId: data.external_thread_id ?? null,
      participantContactIds,
    });
    if (choice.created) {
      const created = await tx.commsConversation.create({
        data: {
          tenancyId: options.tenancyId,
        },
      });
      conversationId = created.id;
      assignmentReason = "manual";
      assignmentConfidence = null;
    } else {
      conversationId = choice.conversationId;
      assignmentReason = choice.reason;
      assignmentConfidence = choice.confidence;
    }
  }

  const relations = data.relations ?? [];
  if (relations.some((relation) => relation.to_message_id == null && relation.external_message_id == null)) {
    throw new StatusError(
      StatusError.BadRequest,
      "Each relation requires to_message_id or external_message_id",
    );
  }
  const relatedMessageIds = [...new Set(
    relations
      .map((relation) => relation.to_message_id)
      .filter((id): id is string => id != null),
  )];
  if (relatedMessageIds.length > 0) {
    const relatedMessages = await tx.commsMessage.findMany({
      where: {
        tenancyId: options.tenancyId,
        id: { in: relatedMessageIds },
      },
      select: { id: true },
    });
    if (relatedMessages.length !== relatedMessageIds.length) {
      throw new StatusError(StatusError.BadRequest, "One or more relation to_message_id values do not exist");
    }
  }

  // Serialize the final parent choice with merge. If merge won the lock, use
  // its one-hop canonical redirect; if ingest won, merge will enumerate this
  // message after it commits.
  await tx.$queryRaw`
    SELECT 1 FROM "CommsConversation"
    WHERE "tenancyId" = ${options.tenancyId}::uuid
      AND "id" = ${conversationId}::uuid
    FOR UPDATE
  `;
  const lockedConversation = await tx.commsConversation.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: conversationId,
      },
    },
    select: { id: true, mergedIntoConversationId: true },
  }) ?? throwErr("Chosen conversation disappeared while locking it", { conversationId });
  conversationId = lockedConversation.mergedIntoConversationId ?? lockedConversation.id;

  const occurredAt = new Date(data.occurred_at_millis);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new StatusError(StatusError.BadRequest, "occurred_at_millis is outside the supported date range");
  }
  const payloadCols = payloadColumns(data.payload);
  const messageId = generateUuid();

  const message = await tx.commsMessage.create({
    data: {
      tenancyId: options.tenancyId,
      id: messageId,
      conversationId,
      direction: data.direction,
      adapterKey: data.adapter_key,
      externalMessageId: data.external_message_id ?? null,
      ingestFingerprint,
      externalThreadId: data.external_thread_id ?? null,
      replyToMessageId: data.reply_to_message_id ?? null,
      occurredAt,
      ...payloadCols,
      rawBlobKey: data.raw_blob_key ?? null,
      participants: {
        create: resolvedParticipants.map((participant) => ({
          tenancyId: options.tenancyId,
          role: participant.role,
          position: participant.position,
          contactId: participant.contactId,
          contactChannelId: participant.contactChannelId,
          addressSnapshot: participant.addressSnapshot,
          displayNameSnapshot: participant.displayNameSnapshot,
        })),
      },
      attachments: {
        create: (data.attachments ?? []).map((attachment) => ({
          tenancyId: options.tenancyId,
          filename: attachment.filename ?? null,
          contentType: attachment.content_type ?? null,
          sizeBytes: attachment.size_bytes ?? null,
          contentId: attachment.content_id ?? null,
          isInline: attachment.is_inline ?? false,
          storageKey: attachment.storage_key ?? null,
          metadata: attachment.metadata === undefined
            ? undefined
            : attachment.metadata === null
              ? Prisma.JsonNull
              : attachment.metadata,
        })),
      },
      relationsFrom: {
        create: (data.relations ?? []).map((relation, index) => ({
          tenancyId: options.tenancyId,
          relationType: relation.relation_type,
          toMessageId: relation.to_message_id ?? null,
          externalMessageId: relation.external_message_id ?? null,
          position: relation.position ?? index,
        })),
      },
    },
    include: messageInclude,
  });

  // Initial assignment is recorded as a reassign operation with fromConversationId=null.
  const operation = await tx.commsConversationOperation.create({
    data: {
      tenancyId: options.tenancyId,
      operationType: "reassign",
      idempotencyKey: `ingest:${messageId}`,
      sourceConversationId: null,
      targetConversationId: conversationId,
      reason: `ingest:${assignmentReason}`,
    },
  });

  await tx.commsMessageAssignment.create({
    data: {
      tenancyId: options.tenancyId,
      messageId,
      operationId: operation.id,
      fromConversationId: null,
      toConversationId: conversationId,
      reason: assignmentReason,
      confidence: assignmentConfidence,
    },
  });

  // A read-then-write loses extrema when two ingests overlap. LEAST/GREATEST
  // evaluate against the row after PostgreSQL acquires its update lock.
  const updatedBounds = await tx.$executeRaw`
    UPDATE "CommsConversation"
    SET
      "firstMessageAt" = LEAST(COALESCE("firstMessageAt", ${occurredAt}), ${occurredAt}),
      "lastMessageAt" = GREATEST(COALESCE("lastMessageAt", ${occurredAt}), ${occurredAt}),
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "tenancyId" = ${options.tenancyId}::uuid
      AND "id" = ${conversationId}::uuid
  `;
  if (updatedBounds !== 1) {
    throw new HexclaveAssertionError("Conversation missing while updating message bounds", { conversationId });
  }

  return { message: messageRowToApi(message), replayed: false };
}
