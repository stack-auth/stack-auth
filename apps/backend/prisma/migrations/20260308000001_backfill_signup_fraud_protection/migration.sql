-- SINGLE_STATEMENT_SENTINEL
-- CONDITIONALLY_REPEAT_MIGRATION_SENTINEL
-- Backfill signedUpAt from createdAt in batches (non-anonymous users only).
-- Anonymous users have not truly "signed up" yet — signedUpAt is set at upgrade time
-- by the risk scoring pipeline, so we leave it NULL to avoid incorrect risk windows.
WITH to_update AS (
    SELECT "projectUserId", "tenancyId"
    FROM "ProjectUser"
    WHERE "signedUpAt" IS NULL
      AND "isAnonymous" = false
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
