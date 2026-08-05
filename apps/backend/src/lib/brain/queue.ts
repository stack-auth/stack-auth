import { globalPrismaClient, PrismaClientTransaction } from "@/prisma-client";
import type { Prisma } from "@/generated/prisma/client";
import type { BrainQueueItemStatus } from "@hexclave/shared/dist/interface/brain";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";
import { ensureBrainRow } from "./ensure";

const DEFAULT_CLAIM_LEASE_MS = 5 * 60 * 1000;
export const BRAIN_QUEUE_MAX_ATTEMPTS = 10;

export function getBrainQueueClaimOwnershipWhere(options: {
  tenancyId: string,
  claims: Array<{ id: string, claimLeaseToken: string }>,
  now: Date,
}): Prisma.BrainQueueItemWhereInput {
  return {
    tenancyId: options.tenancyId,
    status: "CLAIMED",
    claimLeaseUntil: { gt: options.now },
    OR: options.claims.map((claim) => ({
      id: claim.id,
      claimLeaseToken: claim.claimLeaseToken,
    })),
  };
}

export type ListBrainQueueOptions = {
  tenancyId: string,
  statuses?: BrainQueueItemStatus[],
  limit?: number,
  cursor?: { createdAt: Date, id: string } | null,
};

export async function listBrainQueueItems(options: ListBrainQueueOptions) {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const statuses = options.statuses ?? ["QUEUED", "CLAIMED", "FAILED"];

  const rows = await globalPrismaClient.brainQueueItem.findMany({
    where: {
      tenancyId: options.tenancyId,
      status: { in: statuses },
      ...(options.cursor != null ? {
        OR: [
          { createdAt: { lt: options.cursor.createdAt } },
          { createdAt: options.cursor.createdAt, id: { lt: options.cursor.id } },
        ],
      } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && page.length > 0
    ? {
      createdAt: page[page.length - 1].createdAt.toISOString(),
      id: page[page.length - 1].id,
    }
    : null;

  return { items: page, nextCursor };
}

export async function countPendingBrainQueueItems(tenancyId: string): Promise<number> {
  return await globalPrismaClient.brainQueueItem.count({
    where: {
      tenancyId,
      status: { in: ["QUEUED", "CLAIMED"] },
    },
  });
}

/**
 * Atomically claims up to `limit` QUEUED (or expired-CLAIMED) items for the
 * Brain AI tools. Returns only the rows this caller now owns.
 */
export async function claimBrainQueueItems(
  client: PrismaClientTransaction,
  options: {
    tenancyId: string,
    ids?: string[],
    limit?: number,
    leaseMs?: number,
  },
): Promise<Array<{
  id: string,
  type: string,
  schemaVersion: number,
  payload: unknown,
  occurredAt: Date,
  subjectType: string | null,
  subjectId: string | null,
  attempts: number,
  claimLeaseToken: string,
}>> {
  await ensureBrainRow(client, options.tenancyId);
  // JavaScript queue runs process bounded batches in one sandbox invocation.
  // Keep a hard ceiling so a model cannot load an unbounded queue into memory.
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 200);
  if (options.ids != null && options.ids.length > 200) {
    throw new HexclaveAssertionError("Brain queue claim exceeded the item limit", {
      count: options.ids.length,
    });
  }
  const leaseMs = options.leaseMs ?? DEFAULT_CLAIM_LEASE_MS;
  const leaseToken = generateUuid();
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseMs);

  // Dead-letter repeatedly failing work before selecting another attempt.
  // A human retry resets attempts below, making that recovery explicit.
  await client.$executeRaw`
    WITH exhausted AS (
      SELECT "tenancyId", "id"
      FROM "BrainQueueItem"
      WHERE "tenancyId" = ${options.tenancyId}::uuid
        AND "attempts" >= ${BRAIN_QUEUE_MAX_ATTEMPTS}
        AND (
          ("status" = 'QUEUED' AND "availableAt" <= ${now})
          OR ("status" = 'CLAIMED' AND "claimLeaseUntil" IS NOT NULL AND "claimLeaseUntil" < ${now})
        )
      ORDER BY "availableAt" ASC, "createdAt" ASC, "id" ASC
      LIMIT 200
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "BrainQueueItem" AS q
    SET
      "status" = 'FAILED',
      "lastError" = ${`Brain queue item exceeded ${BRAIN_QUEUE_MAX_ATTEMPTS} attempts`},
      "claimLeaseUntil" = NULL,
      "claimLeaseToken" = NULL,
      "updatedAt" = ${now}
    FROM exhausted
    WHERE q."tenancyId" = exhausted."tenancyId"
      AND q."id" = exhausted."id"
  `;

  // Claim by explicit IDs when provided; otherwise take the oldest due items.
  const claimed = options.ids != null && options.ids.length > 0
    ? await client.$queryRaw<Array<{
      id: string,
      type: string,
      schemaVersion: number,
      payload: unknown,
      occurredAt: Date,
      subjectType: string | null,
      subjectId: string | null,
      attempts: number,
      claimLeaseToken: string,
    }>>`
      UPDATE "BrainQueueItem" AS q
      SET
        "status" = 'CLAIMED',
        "attempts" = q."attempts" + 1,
        "claimedAt" = ${now},
        "claimLeaseUntil" = ${leaseUntil},
        "claimLeaseToken" = ${leaseToken}::uuid,
        "updatedAt" = ${now}
      WHERE (q."tenancyId", q."id") IN (
        SELECT c."tenancyId", c."id"
        FROM "BrainQueueItem" AS c
        WHERE c."tenancyId" = ${options.tenancyId}::uuid
          AND c."id" = ANY(${options.ids}::uuid[])
          AND c."attempts" < ${BRAIN_QUEUE_MAX_ATTEMPTS}
          AND (
            c."status" = 'QUEUED'
            OR (c."status" = 'CLAIMED' AND c."claimLeaseUntil" IS NOT NULL AND c."claimLeaseUntil" < ${now})
            OR c."status" = 'FAILED'
          )
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        q."id", q."type", q."schemaVersion", q."payload", q."occurredAt",
        q."subjectType", q."subjectId", q."attempts", q."claimLeaseToken"
    `
    : await client.$queryRaw<Array<{
      id: string,
      type: string,
      schemaVersion: number,
      payload: unknown,
      occurredAt: Date,
      subjectType: string | null,
      subjectId: string | null,
      attempts: number,
      claimLeaseToken: string,
    }>>`
      UPDATE "BrainQueueItem" AS q
      SET
        "status" = 'CLAIMED',
        "attempts" = q."attempts" + 1,
        "claimedAt" = ${now},
        "claimLeaseUntil" = ${leaseUntil},
        "claimLeaseToken" = ${leaseToken}::uuid,
        "updatedAt" = ${now}
      WHERE (q."tenancyId", q."id") IN (
        SELECT c."tenancyId", c."id"
        FROM "BrainQueueItem" AS c
        WHERE c."tenancyId" = ${options.tenancyId}::uuid
          AND c."availableAt" <= ${now}
          AND c."attempts" < ${BRAIN_QUEUE_MAX_ATTEMPTS}
          AND (
            c."status" = 'QUEUED'
            OR (c."status" = 'CLAIMED' AND c."claimLeaseUntil" IS NOT NULL AND c."claimLeaseUntil" < ${now})
          )
        ORDER BY c."availableAt" ASC, c."createdAt" ASC, c."id" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        q."id", q."type", q."schemaVersion", q."payload", q."occurredAt",
        q."subjectType", q."subjectId", q."attempts", q."claimLeaseToken"
    `;

  return claimed;
}

export async function acknowledgeBrainQueueItems(
  client: PrismaClientTransaction,
  options: {
    tenancyId: string,
    claims: Array<{ id: string, claimLeaseToken: string }>,
  },
): Promise<number> {
  if (options.claims.length === 0) return 0;
  const now = new Date();
  const result = await client.brainQueueItem.updateMany({
    where: getBrainQueueClaimOwnershipWhere({ ...options, now }),
    data: {
      status: "COMPLETED",
      completedAt: now,
      claimLeaseUntil: null,
      claimLeaseToken: null,
      lastError: null,
    },
  });
  return result.count;
}

export async function releaseBrainQueueItems(
  client: PrismaClientTransaction,
  options: {
    tenancyId: string,
    claims: Array<{ id: string, claimLeaseToken: string }>,
    error?: string | null,
    /** When true, mark FAILED; otherwise re-queue with backoff. */
    fail?: boolean,
    retryDelayMs?: number,
    /** Undo the claim's attempt increment when no processing was attempted. */
    undoClaimAttempt?: boolean,
  },
): Promise<number> {
  if (options.claims.length === 0) return 0;
  const now = new Date();
  const retryAt = new Date(now.getTime() + (options.retryDelayMs ?? 30_000));
  const claimOwnershipWhere = getBrainQueueClaimOwnershipWhere({ ...options, now });

  if (options.fail) {
    const result = await client.brainQueueItem.updateMany({
      where: claimOwnershipWhere,
      data: {
        status: "FAILED",
        lastError: options.error ?? "Released as failed",
        claimLeaseUntil: null,
        claimLeaseToken: null,
        availableAt: now,
      },
    });
    return result.count;
  }

  const result = await client.brainQueueItem.updateMany({
    where: claimOwnershipWhere,
    data: {
      status: "QUEUED",
      lastError: options.error ?? null,
      claimLeaseUntil: null,
      claimLeaseToken: null,
      availableAt: retryAt,
      ...(options.undoClaimAttempt ? { attempts: { decrement: 1 } } : {}),
    },
  });
  return result.count;
}

/**
 * Requeues claims left behind by a Brain turn that lost its lease or ended
 * without acknowledging them. Claim lease tokens fence this cleanup from a
 * newer worker that may have claimed a different item.
 */
export async function requeueBrainQueueItemsByClaimLease(
  client: PrismaClientTransaction,
  options: {
    tenancyId: string,
    claimLeaseTokens: string[],
    error: string,
    retryDelayMs?: number,
    /** Undo the claim's attempt increment when the script intentionally skipped it. */
    undoClaimAttempt?: boolean,
  },
): Promise<number> {
  if (options.claimLeaseTokens.length === 0) return 0;
  const now = new Date();
  const result = await client.brainQueueItem.updateMany({
    where: {
      tenancyId: options.tenancyId,
      status: "CLAIMED",
      claimLeaseToken: { in: options.claimLeaseTokens },
    },
    data: {
      status: "QUEUED",
      lastError: options.error,
      claimLeaseUntil: null,
      claimLeaseToken: null,
      availableAt: new Date(now.getTime() + (options.retryDelayMs ?? 15_000)),
      ...(options.undoClaimAttempt ? { attempts: { decrement: 1 } } : {}),
    },
  });
  return result.count;
}

/**
 * Once the Brain lease itself has expired, any remaining item claims belong
 * to the abandoned turn and can safely be returned to the queue.
 */
export async function requeueAllClaimedBrainQueueItems(
  client: PrismaClientTransaction,
  options: {
    tenancyId: string,
    error: string,
    retryDelayMs?: number,
  },
): Promise<number> {
  const now = new Date();
  const result = await client.brainQueueItem.updateMany({
    where: {
      tenancyId: options.tenancyId,
      status: "CLAIMED",
    },
    data: {
      status: "QUEUED",
      lastError: options.error,
      claimLeaseUntil: null,
      claimLeaseToken: null,
      availableAt: new Date(now.getTime() + (options.retryDelayMs ?? 15_000)),
    },
  });
  return result.count;
}

export async function retryFailedBrainQueueItems(
  client: PrismaClientTransaction,
  options: { tenancyId: string, ids: string[] },
): Promise<number> {
  if (options.ids.length === 0) return 0;
  const now = new Date();
  const result = await client.brainQueueItem.updateMany({
    where: {
      tenancyId: options.tenancyId,
      id: { in: options.ids },
      status: "FAILED",
    },
    data: {
      status: "QUEUED",
      availableAt: now,
      lastError: null,
      claimLeaseUntil: null,
      claimLeaseToken: null,
      attempts: 0,
    },
  });
  await client.brain.updateMany({
    where: { tenancyId: options.tenancyId },
    data: { runWakeAt: now },
  });
  return result.count;
}
