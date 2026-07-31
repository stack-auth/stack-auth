import { Prisma } from "@/generated/prisma/client";
import type { PrismaTransaction } from "@/lib/types";
import {
  type CommsConversation,
  type CommsMergeConversationsRequest,
  type CommsReassignMessagesRequest,
  type CommsSplitConversationRequest,
} from "@hexclave/shared/dist/interface/comms";
import { StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { generateUuid, isUuid } from "@hexclave/shared/dist/utils/uuids";
import { lockIdempotencyKey, operationMetadataMatches, sortedStringArraysEqual } from "./operation-requests";

function conversationToApi(row: {
  id: string,
  title: string | null,
  mergedIntoConversationId: string | null,
  mergedAt: Date | null,
  firstMessageAt: Date | null,
  lastMessageAt: Date | null,
  createdAt: Date,
  updatedAt: Date,
}): CommsConversation {
  return {
    id: row.id,
    title: row.title,
    merged_into_conversation_id: row.mergedIntoConversationId,
    merged_at_millis: row.mergedAt?.getTime() ?? null,
    first_message_at_millis: row.firstMessageAt?.getTime() ?? null,
    last_message_at_millis: row.lastMessageAt?.getTime() ?? null,
    created_at_millis: row.createdAt.getTime(),
    updated_at_millis: row.updatedAt.getTime(),
  };
}

async function lockConversationsBySortedIds(
  tx: PrismaTransaction,
  tenancyId: string,
  conversationIds: readonly string[],
): Promise<void> {
  const sorted = [...new Set(conversationIds)].sort(stringCompare);
  if (sorted.length === 0) return;
  await tx.$queryRaw`
    SELECT 1 FROM "CommsConversation"
    WHERE "tenancyId" = ${tenancyId}::uuid
      AND "id" = ANY(${sorted}::uuid[])
    ORDER BY "id"
    FOR UPDATE
  `;
}

async function refreshConversationMessageBounds(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    conversationId: string,
  },
): Promise<void> {
  const bounds = await tx.commsMessage.aggregate({
    where: {
      tenancyId: options.tenancyId,
      conversationId: options.conversationId,
    },
    _min: { occurredAt: true },
    _max: { occurredAt: true },
  });
  await tx.commsConversation.update({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.conversationId,
      },
    },
    data: {
      firstMessageAt: bounds._min.occurredAt,
      lastMessageAt: bounds._max.occurredAt,
    },
  });
}

export async function getConversation(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    conversationId: string,
  },
): Promise<CommsConversation | null> {
  const row = await tx.commsConversation.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.conversationId,
      },
    },
  });
  return row == null ? null : conversationToApi(row);
}

export async function listConversations(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    includeMerged?: boolean,
    limit?: number,
    cursor?: string,
  },
): Promise<{ conversations: CommsConversation[], nextCursor: string | null }> {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new StatusError(StatusError.BadRequest, "limit must be an integer between 1 and 200");
  }
  const cursor = (() => {
    if (options.cursor == null) return null;
    const separator = options.cursor.indexOf(":");
    const lastMessageAtPart = options.cursor.slice(0, separator);
    const id = options.cursor.slice(separator + 1);
    const lastMessageAtMillis = lastMessageAtPart === "null" ? null : Number(lastMessageAtPart);
    const cursorDate = lastMessageAtMillis === null ? null : new Date(lastMessageAtMillis);
    if (
      separator <= 0
      || separator === options.cursor.length - 1
      || !isUuid(id)
      || (
        lastMessageAtMillis !== null
        && (!/^-?\d+$/.test(lastMessageAtPart) || !Number.isSafeInteger(lastMessageAtMillis))
      )
      || (cursorDate !== null && Number.isNaN(cursorDate.getTime()))
    ) {
      throw new StatusError(StatusError.BadRequest, "Invalid conversation cursor");
    }
    return { lastMessageAt: cursorDate, id };
  })();

  const rows = await tx.commsConversation.findMany({
    where: {
      tenancyId: options.tenancyId,
      ...(options.includeMerged === true ? {} : { mergedIntoConversationId: null }),
      ...(cursor == null
        ? {}
        : cursor.lastMessageAt === null
          ? {
            lastMessageAt: null,
            id: { lt: cursor.id },
          }
          : {
            OR: [
              { lastMessageAt: { lt: cursor.lastMessageAt } },
              { lastMessageAt: cursor.lastMessageAt, id: { lt: cursor.id } },
              { lastMessageAt: null },
            ],
          }),
    },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: limit + 1,
  });

  const page = rows.slice(0, limit);
  if (rows.length <= limit) {
    return { conversations: page.map(conversationToApi), nextCursor: null };
  }
  const last = page[page.length - 1]
    ?? throwErr("listConversations page unexpectedly empty when hasMore is true");
  return {
    conversations: page.map(conversationToApi),
    nextCursor: `${last.lastMessageAt?.getTime() ?? "null"}:${last.id}`,
  };
}

export async function createConversation(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    title?: string | null,
  },
): Promise<CommsConversation> {
  const row = await tx.commsConversation.create({
    data: {
      tenancyId: options.tenancyId,
      title: options.title ?? null,
    },
  });
  return conversationToApi(row);
}

export async function updateConversation(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    conversationId: string,
    title?: string | null,
  },
): Promise<CommsConversation> {
  const existing = await tx.commsConversation.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.conversationId,
      },
    },
    select: { mergedIntoConversationId: true },
  });
  if (existing == null) {
    throw new StatusError(StatusError.NotFound, "Conversation not found");
  }
  if (existing.mergedIntoConversationId != null) {
    throw new StatusError(StatusError.BadRequest, "Cannot update a merged (non-canonical) conversation");
  }

  const row = await tx.commsConversation.update({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.conversationId,
      },
    },
    data: {
      ...(options.title !== undefined ? { title: options.title } : {}),
    },
  });
  return conversationToApi(row);
}

async function findOperationByIdempotencyKey(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    idempotencyKey: string,
  },
) {
  await lockIdempotencyKey(tx, {
    namespace: "conversation-operation",
    tenancyId: options.tenancyId,
    idempotencyKey: options.idempotencyKey,
  });
  return await tx.commsConversationOperation.findUnique({
    where: {
      tenancyId_idempotencyKey: {
        tenancyId: options.tenancyId,
        idempotencyKey: options.idempotencyKey,
      },
    },
  });
}

export async function mergeConversations(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    request: CommsMergeConversationsRequest,
  },
): Promise<{ operationId: string, conversation: CommsConversation, replayed: boolean }> {
  const request = options.request;
  if (request.source_conversation_id === request.target_conversation_id) {
    throw new StatusError(StatusError.BadRequest, "source and target conversations must differ");
  }

  const existingOperation = await findOperationByIdempotencyKey(tx, {
    tenancyId: options.tenancyId,
    idempotencyKey: request.idempotency_key,
  });
  if (existingOperation != null) {
    if (
      existingOperation.operationType !== "merge"
      || existingOperation.sourceConversationId !== request.source_conversation_id
      || existingOperation.targetConversationId !== request.target_conversation_id
      || existingOperation.actorUserId !== (request.actor_user_id ?? null)
      || existingOperation.reason !== (request.reason ?? null)
      || !operationMetadataMatches(existingOperation.metadata, request.metadata)
    ) {
      throw new StatusError(StatusError.Conflict, "Idempotency key was already used for a different conversation operation");
    }
    const conversation = await getConversation(tx, {
      tenancyId: options.tenancyId,
      conversationId: request.target_conversation_id,
    }) ?? throwErr("Target conversation missing for replayed merge", request);
    return { operationId: existingOperation.id, conversation, replayed: true };
  }

  await lockConversationsBySortedIds(tx, options.tenancyId, [
    request.source_conversation_id,
    request.target_conversation_id,
  ]);

  const [source, target] = await Promise.all([
    tx.commsConversation.findUnique({
      where: { tenancyId_id: { tenancyId: options.tenancyId, id: request.source_conversation_id } },
      include: {
        _count: {
          select: { mergedFromConversations: true },
        },
      },
    }),
    tx.commsConversation.findUnique({
      where: { tenancyId_id: { tenancyId: options.tenancyId, id: request.target_conversation_id } },
    }),
  ]);
  if (source == null) throw new StatusError(StatusError.NotFound, "Source conversation not found");
  if (target == null) throw new StatusError(StatusError.NotFound, "Target conversation not found");
  if (source.mergedIntoConversationId != null) {
    throw new StatusError(StatusError.BadRequest, "Source conversation is already merged");
  }
  if (source._count.mergedFromConversations > 0) {
    throw new StatusError(
      StatusError.BadRequest,
      "Cannot merge a conversation that already has merged source conversations",
    );
  }
  if (target.mergedIntoConversationId != null) {
    throw new StatusError(StatusError.BadRequest, "Target conversation is already merged");
  }

  const operation = await tx.commsConversationOperation.create({
    data: {
      tenancyId: options.tenancyId,
      operationType: "merge",
      idempotencyKey: request.idempotency_key,
      sourceConversationId: request.source_conversation_id,
      targetConversationId: request.target_conversation_id,
      actorUserId: request.actor_user_id ?? null,
      reason: request.reason ?? null,
      metadata: request.metadata === undefined
        ? undefined
        : request.metadata === null
          ? Prisma.JsonNull
          : request.metadata,
    },
  });

  const messages = await tx.commsMessage.findMany({
    where: {
      tenancyId: options.tenancyId,
      conversationId: request.source_conversation_id,
    },
    select: { id: true, conversationId: true },
  });

  for (const message of messages) {
    await tx.commsMessage.update({
      where: {
        tenancyId_id: {
          tenancyId: options.tenancyId,
          id: message.id,
        },
      },
      data: { conversationId: request.target_conversation_id },
    });
    await tx.commsMessageAssignment.create({
      data: {
        tenancyId: options.tenancyId,
        messageId: message.id,
        operationId: operation.id,
        fromConversationId: message.conversationId,
        toConversationId: request.target_conversation_id,
        reason: "merge",
        confidence: 1,
      },
    });
  }

  const now = new Date();
  await tx.commsConversation.update({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: request.source_conversation_id,
      },
    },
    data: {
      mergedIntoConversationId: request.target_conversation_id,
      mergedAt: now,
    },
  });

  await refreshConversationMessageBounds(tx, {
    tenancyId: options.tenancyId,
    conversationId: request.target_conversation_id,
  });

  const conversation = await getConversation(tx, {
    tenancyId: options.tenancyId,
    conversationId: request.target_conversation_id,
  }) ?? throwErr("Target conversation missing after merge", request);

  return { operationId: operation.id, conversation, replayed: false };
}

export async function splitConversation(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    request: CommsSplitConversationRequest,
  },
): Promise<{ operationId: string, conversation: CommsConversation, replayed: boolean }> {
  const request = options.request;
  const messageIds = [...new Set(request.message_ids)].sort(stringCompare);

  const existingOperation = await findOperationByIdempotencyKey(tx, {
    tenancyId: options.tenancyId,
    idempotencyKey: request.idempotency_key,
  });
  if (existingOperation != null) {
    if (
      existingOperation.operationType !== "split"
      || existingOperation.sourceConversationId !== request.source_conversation_id
      || existingOperation.targetConversationId == null
    ) {
      throw new StatusError(StatusError.Conflict, "Idempotency key was already used for a different conversation operation");
    }
    const [conversation, assignments] = await Promise.all([
      getConversation(tx, {
        tenancyId: options.tenancyId,
        conversationId: existingOperation.targetConversationId,
      }),
      tx.commsMessageAssignment.findMany({
        where: {
          tenancyId: options.tenancyId,
          operationId: existingOperation.id,
        },
        select: { messageId: true },
      }),
    ]);
    if (
      existingOperation.actorUserId !== (request.actor_user_id ?? null)
      || existingOperation.reason !== (request.reason ?? null)
      || !operationMetadataMatches(existingOperation.metadata, request.metadata)
      || conversation?.title !== (request.title ?? null)
      || !sortedStringArraysEqual(assignments.map((assignment) => assignment.messageId), messageIds)
    ) {
      throw new StatusError(StatusError.Conflict, "Idempotency key was already used for a different conversation operation");
    }
    return { operationId: existingOperation.id, conversation, replayed: true };
  }

  const targetConversationId = generateUuid();
  await lockConversationsBySortedIds(tx, options.tenancyId, [
    request.source_conversation_id,
    targetConversationId,
  ]);

  const source = await tx.commsConversation.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: request.source_conversation_id,
      },
    },
  });
  if (source == null) {
    throw new StatusError(StatusError.NotFound, "Source conversation not found");
  }
  if (source.mergedIntoConversationId != null) {
    throw new StatusError(StatusError.BadRequest, "Cannot split a merged (non-canonical) conversation");
  }

  const messages = await tx.commsMessage.findMany({
    where: {
      tenancyId: options.tenancyId,
      id: { in: messageIds },
    },
    select: { id: true, conversationId: true },
  });
  if (messages.length !== messageIds.length) {
    throw new StatusError(StatusError.BadRequest, "One or more message_ids were not found");
  }
  for (const message of messages) {
    if (message.conversationId !== request.source_conversation_id) {
      throw new StatusError(
        StatusError.BadRequest,
        `Message ${message.id} is not in source conversation ${request.source_conversation_id}`,
      );
    }
  }

  const target = await tx.commsConversation.create({
    data: {
      tenancyId: options.tenancyId,
      id: targetConversationId,
      title: request.title ?? null,
    },
  });

  const operation = await tx.commsConversationOperation.create({
    data: {
      tenancyId: options.tenancyId,
      operationType: "split",
      idempotencyKey: request.idempotency_key,
      sourceConversationId: request.source_conversation_id,
      targetConversationId: target.id,
      actorUserId: request.actor_user_id ?? null,
      reason: request.reason ?? null,
      metadata: request.metadata === undefined
        ? undefined
        : request.metadata === null
          ? Prisma.JsonNull
          : request.metadata,
    },
  });

  for (const message of messages) {
    await tx.commsMessage.update({
      where: {
        tenancyId_id: {
          tenancyId: options.tenancyId,
          id: message.id,
        },
      },
      data: { conversationId: target.id },
    });
    await tx.commsMessageAssignment.create({
      data: {
        tenancyId: options.tenancyId,
        messageId: message.id,
        operationId: operation.id,
        fromConversationId: message.conversationId,
        toConversationId: target.id,
        reason: "split",
        confidence: 1,
      },
    });
  }

  await refreshConversationMessageBounds(tx, {
    tenancyId: options.tenancyId,
    conversationId: request.source_conversation_id,
  });
  await refreshConversationMessageBounds(tx, {
    tenancyId: options.tenancyId,
    conversationId: target.id,
  });

  return {
    operationId: operation.id,
    conversation: conversationToApi(target),
    replayed: false,
  };
}

export async function reassignMessages(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    request: CommsReassignMessagesRequest,
  },
): Promise<{ operationId: string, conversation: CommsConversation, replayed: boolean }> {
  const request = options.request;
  const messageIds = [...new Set(request.message_ids)].sort(stringCompare);

  const existingOperation = await findOperationByIdempotencyKey(tx, {
    tenancyId: options.tenancyId,
    idempotencyKey: request.idempotency_key,
  });
  if (existingOperation != null) {
    if (
      existingOperation.operationType !== "reassign"
      || existingOperation.targetConversationId !== request.target_conversation_id
    ) {
      throw new StatusError(StatusError.Conflict, "Idempotency key was already used for a different conversation operation");
    }
    const [conversation, assignments] = await Promise.all([
      getConversation(tx, {
        tenancyId: options.tenancyId,
        conversationId: request.target_conversation_id,
      }),
      tx.commsMessageAssignment.findMany({
        where: {
          tenancyId: options.tenancyId,
          operationId: existingOperation.id,
        },
        select: { messageId: true },
      }),
    ]);
    if (
      existingOperation.actorUserId !== (request.actor_user_id ?? null)
      || existingOperation.reason !== (request.reason ?? null)
      || !operationMetadataMatches(existingOperation.metadata, request.metadata)
      || !sortedStringArraysEqual(assignments.map((assignment) => assignment.messageId), messageIds)
    ) {
      throw new StatusError(StatusError.Conflict, "Idempotency key was already used for a different conversation operation");
    }
    const replayedConversation = conversation ?? throwErr("Target conversation missing for replayed reassign", request);
    return { operationId: existingOperation.id, conversation: replayedConversation, replayed: true };
  }

  let messages = await tx.commsMessage.findMany({
    where: {
      tenancyId: options.tenancyId,
      id: { in: messageIds },
    },
    select: { id: true, conversationId: true },
  });
  if (messages.length !== messageIds.length) {
    throw new StatusError(StatusError.BadRequest, "One or more message_ids were not found");
  }

  const conversationIdsToLock = [
    request.target_conversation_id,
    ...messages.map((m) => m.conversationId),
  ];
  await lockConversationsBySortedIds(tx, options.tenancyId, conversationIdsToLock);
  const lockedConversationIds = new Set(conversationIdsToLock);
  messages = await tx.commsMessage.findMany({
    where: {
      tenancyId: options.tenancyId,
      id: { in: messageIds },
    },
    select: { id: true, conversationId: true },
  });
  if (messages.length !== messageIds.length) {
    throw new StatusError(StatusError.BadRequest, "One or more message_ids were not found");
  }
  if (messages.some((message) => !lockedConversationIds.has(message.conversationId))) {
    throw new StatusError(
      StatusError.Conflict,
      "Message assignments changed concurrently; retry the reassign operation",
    );
  }

  const target = await tx.commsConversation.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: request.target_conversation_id,
      },
    },
  });
  if (target == null) {
    throw new StatusError(StatusError.NotFound, "Target conversation not found");
  }
  if (target.mergedIntoConversationId != null) {
    throw new StatusError(StatusError.BadRequest, "Cannot reassign messages into a merged conversation");
  }

  const operation = await tx.commsConversationOperation.create({
    data: {
      tenancyId: options.tenancyId,
      operationType: "reassign",
      idempotencyKey: request.idempotency_key,
      sourceConversationId: null,
      targetConversationId: request.target_conversation_id,
      actorUserId: request.actor_user_id ?? null,
      reason: request.reason ?? null,
      metadata: request.metadata === undefined
        ? undefined
        : request.metadata === null
          ? Prisma.JsonNull
          : request.metadata,
    },
  });

  const affectedSourceIds = new Set<string>();
  for (const message of messages) {
    if (message.conversationId === request.target_conversation_id) {
      await tx.commsMessageAssignment.create({
        data: {
          tenancyId: options.tenancyId,
          messageId: message.id,
          operationId: operation.id,
          fromConversationId: message.conversationId,
          toConversationId: request.target_conversation_id,
          reason: "manual",
          confidence: 1,
        },
      });
      continue;
    }
    affectedSourceIds.add(message.conversationId);
    await tx.commsMessage.update({
      where: {
        tenancyId_id: {
          tenancyId: options.tenancyId,
          id: message.id,
        },
      },
      data: { conversationId: request.target_conversation_id },
    });
    await tx.commsMessageAssignment.create({
      data: {
        tenancyId: options.tenancyId,
        messageId: message.id,
        operationId: operation.id,
        fromConversationId: message.conversationId,
        toConversationId: request.target_conversation_id,
        reason: "manual",
        confidence: 1,
      },
    });
  }

  for (const sourceId of affectedSourceIds) {
    await refreshConversationMessageBounds(tx, {
      tenancyId: options.tenancyId,
      conversationId: sourceId,
    });
  }
  await refreshConversationMessageBounds(tx, {
    tenancyId: options.tenancyId,
    conversationId: request.target_conversation_id,
  });

  return {
    operationId: operation.id,
    conversation: conversationToApi(target),
    replayed: false,
  };
}
