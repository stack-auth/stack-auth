-- Maintained per-tab segment bounds (min firstEventAt / max lastEventAt), updated
-- O(1) per replay batch via LEAST/GREATEST upsert instead of re-aggregating over
-- the segment's chunks on every upload.
--
-- The table starts empty and there is no backfill statement here: segments that
-- predate it are seeded lazily by upsertSessionReplaySegmentBounds, which
-- aggregates the segment's existing chunks the first time it sees a segment with
-- no row. That keeps this migration O(1) on a table with millions of chunks, and
-- the aggregate is bounded by one replay's chunk count.
--
-- The two foreign keys are added as validating constraints rather than
-- NOT VALID + VALIDATE: the child table is empty, so there is nothing to
-- validate, and NOT VALID would still take the same lock on the referenced
-- tables to install the trigger. Splitting it would add a migration without
-- shortening the lock.
--
-- No secondary indexes: both cascade paths ((tenancyId, sessionReplayId) from
-- SessionReplay and (tenancyId) from Tenancy) are prefixes of the primary key,
-- as is the upsert's conflict target.

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
