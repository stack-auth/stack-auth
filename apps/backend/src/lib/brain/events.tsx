import type { Tenancy } from "@/lib/tenancies";
import { PrismaClientTransaction } from "@/prisma-client";
import {
  BRAIN_EVENT_PAYLOAD_MAX_BYTES,
  type BrainEventType,
} from "@hexclave/shared/dist/interface/brain";
import { captureError, HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";
import { createHash } from "node:crypto";
import { ensureBrainRow } from "./ensure";
import { sanitizeBrainPayload } from "./sanitize";

/**
 * Deterministic UUID for Brain enqueue/append idempotency (UUIDv5-style over sha256).
 */
export function deterministicBrainUuid(name: string): string {
  const hash = createHash("sha256").update("hexclave-brain:").update(name).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isBrainEnabled(tenancy: Pick<Tenancy, "config">): boolean {
  return tenancy.config.apps.installed.brain?.enabled === true;
}

export type EnqueueBrainEventOptions = {
  tenancy: Pick<Tenancy, "id" | "config">,
  type: BrainEventType | (string & {}),
  payload: unknown,
  schemaVersion?: number,
  occurredAt?: Date,
  subjectType?: string | null,
  subjectId?: string | null,
  /** Deterministic key; duplicates are silently skipped. */
  idempotencyKey?: string | null,
  eventId?: string,
};

/**
 * Inserts a Brain queue item inside the caller's transaction when the Brain
 * app is installed for this tenancy. Oversized / unexpected failures are
 * captured rather than thrown so entity mutations never fail because of Brain.
 *
 * NOTE ON SHARDING: same caveat as workflow events — today the global Prisma
 * client is the tenancy client, so this stays transactional. Revisit if
 * source-of-truth sharding lands.
 */
export async function enqueueBrainEvent(
  client: PrismaClientTransaction,
  options: EnqueueBrainEventOptions,
): Promise<{ eventId: string } | null> {
  if (!isBrainEnabled(options.tenancy)) {
    return null;
  }

  const sanitized = sanitizeBrainPayload(options.payload);
  const payloadJson = JSON.stringify(sanitized ?? null);
  const payloadBytes = Buffer.byteLength(payloadJson, "utf8");
  if (payloadBytes > BRAIN_EVENT_PAYLOAD_MAX_BYTES) {
    captureError("brain-event-payload-too-large", new HexclaveAssertionError(
      `Brain event payload for ${options.type} is ${payloadBytes} bytes, exceeding the ${BRAIN_EVENT_PAYLOAD_MAX_BYTES}-byte limit; the event was dropped`,
      { tenancyId: options.tenancy.id, type: options.type },
    ));
    return null;
  }

  try {
    await ensureBrainRow(client, options.tenancy.id);

    const eventId = options.eventId ?? generateUuid();
    await client.brainQueueItem.createMany({
      data: [{
        tenancyId: options.tenancy.id,
        id: eventId,
        type: options.type,
        schemaVersion: options.schemaVersion ?? 1,
        payload: JSON.parse(payloadJson),
        occurredAt: options.occurredAt ?? new Date(),
        subjectType: options.subjectType ?? null,
        subjectId: options.subjectId ?? null,
        idempotencyKey: options.idempotencyKey ?? null,
        status: "QUEUED",
        availableAt: new Date(),
      }],
      skipDuplicates: true,
    });

    await client.brain.updateMany({
      where: { tenancyId: options.tenancy.id },
      data: { runWakeAt: new Date() },
    });

    return { eventId };
  } catch (error) {
    captureError("brain-event-enqueue-failed", error);
    return null;
  }
}
