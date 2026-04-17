-- Backfill `signedUpAt` from `createdAt` in small batches so the migration stays
-- safely under the transaction timeout on large tables.
-- SINGLE_STATEMENT_SENTINEL
-- CONDITIONALLY_REPEAT_MIGRATION_SENTINEL
WITH to_update AS (
  SELECT "projectUserId", "tenancyId"
  FROM "ProjectUser"
  WHERE "signedUpAt" IS NULL
  LIMIT 10000
),
updated AS (
  UPDATE "ProjectUser" pu
  SET "signedUpAt" = pu."createdAt"
  FROM to_update tu
  WHERE pu."tenancyId" = tu."tenancyId"
    AND pu."projectUserId" = tu."projectUserId"
  RETURNING 1
)
SELECT COUNT(*) > 0 AS should_repeat_migration FROM updated;
