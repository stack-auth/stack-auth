-- Backfill the trigger-maintained replacement status column in batches so the
-- migration stays under the transaction timeout on large EmailOutbox tables.

-- SINGLE_STATEMENT_SENTINEL
-- CONDITIONALLY_REPEAT_MIGRATION_SENTINEL
WITH to_update AS (
  SELECT "tenancyId", "id"
  FROM "EmailOutbox"
  WHERE "status_v2" IS NULL
  LIMIT 10000
),
updated AS (
  UPDATE "EmailOutbox" eo
  -- This self-assignment intentionally fires the temporary BEFORE UPDATE trigger,
  -- which computes status_v2 from the row's current status-driving fields.
  SET "status_v2" = eo."status_v2"
  FROM to_update tu
  WHERE eo."tenancyId" = tu."tenancyId"
    AND eo."id" = tu."id"
  RETURNING 1
)
SELECT COUNT(*) > 0 AS should_repeat_migration FROM updated;
