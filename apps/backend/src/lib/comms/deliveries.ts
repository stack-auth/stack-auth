import { Prisma } from "@/generated/prisma/client";
import type { PrismaTransaction } from "@/lib/types";
import {
  commsDeliveryAttemptOutcomeValues,
  commsDeliveryStatusValues,
  type CommsDelivery,
  type CommsDeliveryAttempt,
  type CommsDeliveryAttemptOutcome,
  type CommsDeliveryStatus,
} from "@hexclave/shared/dist/interface/comms";
import { HexclaveAssertionError, StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";

function isCommsDeliveryStatus(status: string): status is CommsDeliveryStatus {
  return (commsDeliveryStatusValues as readonly string[]).includes(status);
}

function isCommsDeliveryAttemptOutcome(outcome: string): outcome is CommsDeliveryAttemptOutcome {
  return (commsDeliveryAttemptOutcomeValues as readonly string[]).includes(outcome);
}

function parseDeliveryStatus(status: string): CommsDeliveryStatus {
  if (isCommsDeliveryStatus(status)) {
    return status;
  }
  throw new HexclaveAssertionError(`Unexpected CommsDelivery.status value from DB: ${status}`);
}

function parseDeliveryAttemptOutcome(outcome: string): CommsDeliveryAttemptOutcome {
  if (isCommsDeliveryAttemptOutcome(outcome)) {
    return outcome;
  }
  throw new HexclaveAssertionError(`Unexpected CommsDeliveryAttempt.outcome value from DB: ${outcome}`);
}

function attemptToApi(row: {
  id: string,
  attemptNumber: number,
  outcome: string,
  attemptedAt: Date,
  finishedAt: Date | null,
  providerResponse: Prisma.JsonValue | null,
  errorPublic: string | null,
  errorInternal: string | null,
}): CommsDeliveryAttempt {
  return {
    id: row.id,
    attempt_number: row.attemptNumber,
    outcome: parseDeliveryAttemptOutcome(row.outcome),
    attempted_at_millis: row.attemptedAt.getTime(),
    finished_at_millis: row.finishedAt?.getTime() ?? null,
    provider_response: row.providerResponse,
    error_public: row.errorPublic,
    error_internal: row.errorInternal,
  };
}

function deliveryToApi(row: {
  id: string,
  messageId: string,
  participantId: string | null,
  addressSnapshot: string,
  status: string,
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
  attempts?: Array<{
    id: string,
    attemptNumber: number,
    outcome: string,
    attemptedAt: Date,
    finishedAt: Date | null,
    providerResponse: Prisma.JsonValue | null,
    errorPublic: string | null,
    errorInternal: string | null,
  }>,
}): CommsDelivery {
  return {
    id: row.id,
    message_id: row.messageId,
    participant_id: row.participantId,
    address_snapshot: row.addressSnapshot,
    status: parseDeliveryStatus(row.status),
    provider_message_id: row.providerMessageId,
    skipped_reason: row.skippedReason,
    last_error_public: row.lastErrorPublic,
    last_error_internal: row.lastErrorInternal,
    sent_at_millis: row.sentAt?.getTime() ?? null,
    delivered_at_millis: row.deliveredAt?.getTime() ?? null,
    bounced_at_millis: row.bouncedAt?.getTime() ?? null,
    failed_at_millis: row.failedAt?.getTime() ?? null,
    created_at_millis: row.createdAt.getTime(),
    updated_at_millis: row.updatedAt.getTime(),
    ...(row.attempts != null ? { attempts: row.attempts.map(attemptToApi) } : {}),
  };
}

export async function createDelivery(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    messageId: string,
    addressSnapshot: string,
    participantId?: string | null,
    status?: CommsDeliveryStatus,
  },
): Promise<CommsDelivery> {
  const message = await tx.commsMessage.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.messageId,
      },
    },
    select: { id: true, direction: true },
  });
  if (message == null) {
    throw new StatusError(StatusError.NotFound, "Message not found");
  }
  if (message.direction !== "outbound") {
    throw new StatusError(StatusError.BadRequest, "Deliveries can only be created for outbound messages");
  }

  if (options.participantId != null) {
    const participant = await tx.commsMessageParticipant.findUnique({
      where: {
        tenancyId_id: {
          tenancyId: options.tenancyId,
          id: options.participantId,
        },
      },
      select: { messageId: true },
    });
    if (participant == null || participant.messageId !== options.messageId) {
      throw new StatusError(
        StatusError.BadRequest,
        "participant_id must identify a participant of this message",
      );
    }
  }

  const row = await tx.commsDelivery.create({
    data: {
      tenancyId: options.tenancyId,
      messageId: options.messageId,
      participantId: options.participantId ?? null,
      addressSnapshot: options.addressSnapshot,
      status: options.status ?? "pending",
    },
  });
  return deliveryToApi(row);
}

export async function recordAttempt(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    deliveryId: string,
    outcome: CommsDeliveryAttemptOutcome,
    providerResponse?: Prisma.InputJsonValue | null,
    errorPublic?: string | null,
    errorInternal?: string | null,
    finishedAt?: Date | null,
    /**
     * When set, also advances the delivery status (and related timestamps).
     * Callers that only want an attempt row can omit this and call updateDeliveryStatus separately.
     */
    status?: CommsDeliveryStatus,
    providerMessageId?: string | null,
  },
): Promise<{ delivery: CommsDelivery, attempt: CommsDeliveryAttempt }> {
  // Attempt numbering is scoped to one delivery. Lock it before reading the
  // latest attempt so concurrent writers cannot choose the same number.
  await tx.$queryRaw`
    SELECT 1 FROM "CommsDelivery"
    WHERE "tenancyId" = ${options.tenancyId}::uuid
      AND "id" = ${options.deliveryId}::uuid
    FOR UPDATE
  `;
  const delivery = await tx.commsDelivery.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.deliveryId,
      },
    },
    include: {
      attempts: {
        orderBy: { attemptNumber: "desc" },
        take: 1,
      },
    },
  });
  if (delivery == null) {
    throw new StatusError(StatusError.NotFound, "Delivery not found");
  }

  const lastAttemptNumber = delivery.attempts[0]?.attemptNumber ?? 0;
  const attemptNumber = lastAttemptNumber + 1;
  const finishedAt = options.finishedAt === undefined ? new Date() : options.finishedAt;

  const attempt = await tx.commsDeliveryAttempt.create({
    data: {
      tenancyId: options.tenancyId,
      deliveryId: options.deliveryId,
      attemptNumber,
      outcome: options.outcome,
      finishedAt,
      providerResponse: options.providerResponse === undefined
        ? undefined
        : options.providerResponse === null
          ? Prisma.JsonNull
          : options.providerResponse,
      errorPublic: options.errorPublic ?? null,
      errorInternal: options.errorInternal ?? null,
    },
  });

  if (options.status != null || options.providerMessageId !== undefined || options.errorPublic !== undefined || options.errorInternal !== undefined) {
    await updateDeliveryStatusInternal(tx, {
      tenancyId: options.tenancyId,
      deliveryId: options.deliveryId,
      status: options.status,
      providerMessageId: options.providerMessageId,
      lastErrorPublic: options.errorPublic,
      lastErrorInternal: options.errorInternal,
    });
  }

  const withAttempts = await tx.commsDelivery.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.deliveryId,
      },
    },
    include: {
      attempts: { orderBy: { attemptNumber: "asc" } },
    },
  }) ?? throwErr("Delivery missing after recording attempt", options);

  return {
    delivery: deliveryToApi(withAttempts),
    attempt: attemptToApi(attempt),
  };
}

async function updateDeliveryStatusInternal(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    deliveryId: string,
    status?: CommsDeliveryStatus,
    providerMessageId?: string | null,
    skippedReason?: string | null,
    lastErrorPublic?: string | null,
    lastErrorInternal?: string | null,
  },
) {
  await tx.$queryRaw`
    SELECT 1 FROM "CommsDelivery"
    WHERE "tenancyId" = ${options.tenancyId}::uuid
      AND "id" = ${options.deliveryId}::uuid
    FOR UPDATE
  `;
  const existing = await tx.commsDelivery.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.deliveryId,
      },
    },
  });
  if (existing == null) {
    throw new StatusError(StatusError.NotFound, "Delivery not found");
  }

  const now = new Date();
  const status = options.status;
  return await tx.commsDelivery.update({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.deliveryId,
      },
    },
    data: {
      ...(status != null ? { status } : {}),
      ...(options.providerMessageId !== undefined ? { providerMessageId: options.providerMessageId } : {}),
      ...(options.skippedReason !== undefined ? { skippedReason: options.skippedReason } : {}),
      ...(options.lastErrorPublic !== undefined ? { lastErrorPublic: options.lastErrorPublic } : {}),
      ...(options.lastErrorInternal !== undefined ? { lastErrorInternal: options.lastErrorInternal } : {}),
      ...(status === "sent" ? { sentAt: existing.sentAt ?? now } : {}),
      ...(status === "delivered" ? { deliveredAt: existing.deliveredAt ?? now, sentAt: existing.sentAt ?? now } : {}),
      ...(status === "bounced" ? { bouncedAt: existing.bouncedAt ?? now } : {}),
      ...(status === "failed" ? { failedAt: existing.failedAt ?? now } : {}),
    },
    include: {
      attempts: true,
    },
  });
}

export async function updateDeliveryStatus(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    deliveryId: string,
    status: CommsDeliveryStatus,
    providerMessageId?: string | null,
    skippedReason?: string | null,
    lastErrorPublic?: string | null,
    lastErrorInternal?: string | null,
  },
): Promise<CommsDelivery> {
  const updated = await updateDeliveryStatusInternal(tx, options);
  return deliveryToApi(updated);
}

export async function getDelivery(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    deliveryId: string,
  },
): Promise<CommsDelivery | null> {
  const row = await tx.commsDelivery.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.deliveryId,
      },
    },
    include: {
      attempts: { orderBy: { attemptNumber: "asc" } },
    },
  });
  return row == null ? null : deliveryToApi(row);
}

export async function listDeliveriesForMessage(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    messageId: string,
  },
): Promise<CommsDelivery[]> {
  const message = await tx.commsMessage.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.messageId,
      },
    },
    select: { id: true },
  });
  if (message == null) {
    throw new StatusError(StatusError.NotFound, "Message not found");
  }

  const rows = await tx.commsDelivery.findMany({
    where: {
      tenancyId: options.tenancyId,
      messageId: options.messageId,
    },
    include: {
      attempts: { orderBy: { attemptNumber: "asc" } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(deliveryToApi);
}
