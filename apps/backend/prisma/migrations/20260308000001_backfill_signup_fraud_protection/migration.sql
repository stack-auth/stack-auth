-- SINGLE_STATEMENT_SENTINEL
-- CONDITIONALLY_REPEAT_MIGRATION_SENTINEL
-- Backfill signedUpAt from createdAt in batches for all users (including anonymous).
-- Risk score queries filter by isAnonymous explicitly, so NULL signedUpAt is no longer needed.
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
    WHERE pu."tenancyId" = tu."tenancyId" AND pu."projectUserId" = tu."projectUserId"
    RETURNING 1
)
SELECT COUNT(*) > 0 AS should_repeat_migration FROM updated;
