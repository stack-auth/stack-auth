import { PrismaClient } from "@/generated/prisma/client";
import { PrismaClientWithReplica } from "@/prisma-client";
import { throwErr } from "@hexclave/shared/dist/utils/errors";

export const SESSION_IDLE_TIMEOUT_MS = 3 * 60 * 1000;
export const MAX_SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

export async function findRecentSessionReplay(prisma: PrismaClientWithReplica<PrismaClient>, options: {
  tenancyId: string,
  refreshTokenId: string,
  projectUserId?: string,
}) {
  const cutoff = new Date(Date.now() - SESSION_IDLE_TIMEOUT_MS);
  const maxDurationCutoff = new Date(Date.now() - MAX_SESSION_DURATION_MS);
  return await prisma.sessionReplay.findFirst({
    where: {
      tenancyId: options.tenancyId,
      refreshTokenId: options.refreshTokenId,
      ...options.projectUserId !== undefined ? { projectUserId: options.projectUserId } : {},
      updatedAt: { gte: cutoff },
      startedAt: { gte: maxDurationCutoff },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, startedAt: true, lastEventAt: true },
  });
}

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

  const rows = await prisma.$queryRaw<Array<{ firstEventAt: Date, lastEventAt: Date }>>`
    INSERT INTO "SessionReplaySegment" ("tenancyId", "sessionReplayId", "id", "firstEventAt", "lastEventAt", "createdAt", "updatedAt")
    VALUES (${options.tenancyId}::uuid, ${options.sessionReplayId}::uuid, ${options.sessionReplaySegmentId}, ${firstEventAt}, ${lastEventAt}, NOW(), NOW())
    ON CONFLICT ("tenancyId", "sessionReplayId", "id") DO UPDATE SET
      "firstEventAt" = LEAST("SessionReplaySegment"."firstEventAt", EXCLUDED."firstEventAt"),
      "lastEventAt" = GREATEST("SessionReplaySegment"."lastEventAt", EXCLUDED."lastEventAt"),
      "updatedAt" = NOW()
    RETURNING "firstEventAt", "lastEventAt"
  `;
  const row = rows[0] ?? throwErr("upsertSessionReplaySegmentBounds: upsert returned no row — INSERT ... ON CONFLICT DO UPDATE should always return the affected row");
  return { firstEventAt: row.firstEventAt, lastEventAt: row.lastEventAt };
}
