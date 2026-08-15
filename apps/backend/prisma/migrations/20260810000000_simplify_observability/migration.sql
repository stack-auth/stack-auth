-- Batch identities are transport strings, not database UUIDs.
--
-- Sentry envelope batches intentionally use a content-derived identifier and
-- OTLP batches may use a deterministic request hash. The ClickHouse source
-- column is already String, so keeping the Postgres ledger in lockstep avoids
-- rejecting valid non-UUID protocol batches before they can be materialized.

-- New installations already create this column as VARCHAR(512) in the original
-- add_issues migration, so production does not rewrite the ledger at all. This
-- compatibility branch is only for pre-release environments that ran an older
-- version of that migration. Fail quickly instead of waiting behind live
-- traffic if one of those environments has a busy ledger.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '5min';

-- The DO block below must be its own single statement: the migration runner
-- wraps non-single-statement chunks in its own dollar-quoted DO envelope, and
-- a nested dollar-quote delimiter would terminate the outer quoting and break
-- parsing. (Same reason this comment spells it out instead of writing the
-- delimiter.)
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
DO $$
BEGIN
  IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'IssueMaterialization'
        AND column_name = 'batchId'
        AND udt_name = 'uuid'
  ) THEN
    ALTER TABLE "IssueMaterialization"
      ALTER COLUMN "batchId" TYPE VARCHAR(512)
      USING "batchId"::text;
  END IF;
END
$$;
