-- Maintained per-tab segment bounds (min firstEventAt / max lastEventAt), updated
-- O(1) per replay batch via LEAST/GREATEST upsert instead of re-aggregating over
-- the segment's chunks on every upload. New empty table, so no batching/backfill
-- sentinels are needed; pre-existing segments are lazily seeded from their chunks
-- on the first post-deploy batch (see upsertSessionReplaySegmentBounds).

-- CreateTable
CREATE TABLE "SessionReplaySegment" (
    "id" TEXT NOT NULL,
    "tenancyId" UUID NOT NULL,
    "sessionReplayId" UUID NOT NULL,
    "firstEventAt" TIMESTAMP(3) NOT NULL,
    "lastEventAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionReplaySegment_pkey" PRIMARY KEY ("tenancyId","sessionReplayId","id")
);

-- AddForeignKey
ALTER TABLE "SessionReplaySegment" ADD CONSTRAINT "SessionReplaySegment_tenancyId_sessionReplayId_fkey" FOREIGN KEY ("tenancyId", "sessionReplayId") REFERENCES "SessionReplay"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionReplaySegment" ADD CONSTRAINT "SessionReplaySegment_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
