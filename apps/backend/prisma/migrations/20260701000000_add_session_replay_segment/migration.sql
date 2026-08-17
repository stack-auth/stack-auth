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
-- The table and each foreign key are separate outside-transaction statements.
-- PostgreSQL holds the referenced-table lock until the statement transaction
-- commits, so keeping both FKs inside the migration transaction would extend
-- the first lock through every later statement and the bookkeeping insert.
--
-- No secondary indexes: both cascade paths ((tenancyId, sessionReplayId) from
-- SessionReplay and (tenancyId) from Tenancy) are prefixes of the primary key,
-- as is the upsert's conflict target.

-- The FK adds below take a brief SHARE ROW EXCLUSIVE lock on the hot referenced
-- tables (SessionReplay, Tenancy). Each DO block sets a local timeout and runs
-- outside the bookkeeping transaction, so the lock is released immediately
-- after that one constraint is installed.

-- CreateTable
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE TABLE IF NOT EXISTS /* SCHEMA_NAME_SENTINEL */."SessionReplaySegment" (
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
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '2s', true);
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'SessionReplaySegment_tenancyId_sessionReplayId_fkey'
      AND conrelid = '/* SCHEMA_NAME_SENTINEL */."SessionReplaySegment"'::regclass
  ) THEN
    EXECUTE 'ALTER TABLE /* SCHEMA_NAME_SENTINEL */."SessionReplaySegment" ADD CONSTRAINT "SessionReplaySegment_tenancyId_sessionReplayId_fkey" FOREIGN KEY ("tenancyId", "sessionReplayId") REFERENCES /* SCHEMA_NAME_SENTINEL */."SessionReplay"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END
$$;

-- AddForeignKey
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '2s', true);
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'SessionReplaySegment_tenancyId_fkey'
      AND conrelid = '/* SCHEMA_NAME_SENTINEL */."SessionReplaySegment"'::regclass
  ) THEN
    EXECUTE 'ALTER TABLE /* SCHEMA_NAME_SENTINEL */."SessionReplaySegment" ADD CONSTRAINT "SessionReplaySegment_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES /* SCHEMA_NAME_SENTINEL */."Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END
$$;
