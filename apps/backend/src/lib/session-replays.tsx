import { PrismaClient } from "@/generated/prisma/client";
import { PrismaClientWithReplica } from "@/prisma-client";
import { throwErr } from "@hexclave/shared/dist/utils/errors";

export const SESSION_IDLE_TIMEOUT_MS = 3 * 60 * 1000;
export const MAX_SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

export async function findRecentSessionReplay(prisma: PrismaClientWithReplica<PrismaClient>, options: {
  tenancyId: string,
  refreshTokenId: string,
}) {
  const cutoff = new Date(Date.now() - SESSION_IDLE_TIMEOUT_MS);
  const maxDurationCutoff = new Date(Date.now() - MAX_SESSION_DURATION_MS);
  return await prisma.sessionReplay.findFirst({
    where: {
      tenancyId: options.tenancyId,
      refreshTokenId: options.refreshTokenId,
      updatedAt: { gte: cutoff },
      startedAt: { gte: maxDurationCutoff },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, startedAt: true, lastEventAt: true },
  });
}

/**
 * Maintains the per-tab segment's event-time bounds in O(1) per batch: a single-row
 * LEAST/GREATEST upsert instead of re-aggregating min/max over all of the segment's
 * chunks on every upload (SessionReplayChunk has >>1M rows). Returns the maintained
 * bounds, which feed the $session-replay-segment span in ClickHouse.
 *
 * Bounds can only widen (LEAST/GREATEST are commutative and idempotent), so
 * concurrent batches converge to the same result regardless of order — no
 * transaction or row lock is needed.
 *
 * Segments that predate this table get lazily seeded: if the row doesn't exist yet,
 * we aggregate the segment's existing chunks once (the current batch's chunk is
 * already inserted at this point, so it's included) and upsert that. A concurrent
 * seeder racing us just makes the ON CONFLICT branch take over, which is correct.
 */
export async function upsertSessionReplaySegmentBounds(prisma: PrismaClientWithReplica<PrismaClient>, options: {
  tenancyId: string,
  sessionReplayId: string,
  sessionReplaySegmentId: string,
  batchFirstEventAt: Date,
  batchLastEventAt: Date,
}): Promise<{ firstEventAt: Date, lastEventAt: Date }> {
  const existing = await prisma.sessionReplaySegment.findUnique({
    where: {
      tenancyId_sessionReplayId_id: {
        tenancyId: options.tenancyId,
        sessionReplayId: options.sessionReplayId,
        id: options.sessionReplaySegmentId,
      },
    },
    select: { id: true },
  });

  let firstEventAt = options.batchFirstEventAt;
  let lastEventAt = options.batchLastEventAt;
  if (existing == null) {
    // First sighting of this segment since the table was introduced — seed from
    // the chunks so bounds of pre-existing segments don't start at this batch.
    const seed = await prisma.sessionReplayChunk.aggregate({
      where: {
        tenancyId: options.tenancyId,
        sessionReplayId: options.sessionReplayId,
        sessionReplaySegmentId: options.sessionReplaySegmentId,
      },
      _min: { firstEventAt: true },
      _max: { lastEventAt: true },
    });
    firstEventAt = new Date(Math.min(firstEventAt.getTime(), seed._min.firstEventAt?.getTime() ?? Infinity));
    lastEventAt = new Date(Math.max(lastEventAt.getTime(), seed._max.lastEventAt?.getTime() ?? -Infinity));
  }

  // This is a write, so it must go to the primary (no $replica()).
  const rows = await prisma.$queryRaw<Array<{ firstEventAt: Date, lastEventAt: Date }>>`
    INSERT INTO "SessionReplaySegment" ("tenancyId", "sessionReplayId", "id", "firstEventAt", "lastEventAt", "createdAt", "updatedAt")
    VALUES (${options.tenancyId}::uuid, ${options.sessionReplayId}::uuid, ${options.sessionReplaySegmentId}, ${firstEventAt}, ${lastEventAt}, NOW(), NOW())
    ON CONFLICT ("tenancyId", "sessionReplayId", "id") DO UPDATE SET
      "firstEventAt" = LEAST("SessionReplaySegment"."firstEventAt", EXCLUDED."firstEventAt"),
      "lastEventAt" = GREATEST("SessionReplaySegment"."lastEventAt", EXCLUDED."lastEventAt"),
      "updatedAt" = NOW()
    RETURNING "firstEventAt", "lastEventAt"
  `;
  // INSERT ... ON CONFLICT DO UPDATE always affects exactly one row, so RETURNING
  // must yield it; an empty result means the query shape itself is broken.
  const row = rows[0] ?? throwErr("upsertSessionReplaySegmentBounds: upsert returned no row — INSERT ... ON CONFLICT DO UPDATE should always return the affected row");
  return { firstEventAt: row.firstEventAt, lastEventAt: row.lastEventAt };
}
