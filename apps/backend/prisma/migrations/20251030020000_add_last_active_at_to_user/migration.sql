-- Add lastActiveAt field to ProjectUser table to store last logged in timestamp
-- This replaces the need to query session activity events for this information
ALTER TABLE "ProjectUser" ADD COLUMN "lastActiveAt" TIMESTAMP(3);

-- SPLIT_STATEMENT_SENTINEL

-- Populate initial values from the latest session activity event for each user
-- This is a one-time data migration to backfill the new field
-- We process in batches of 1000 to avoid long-running transactions
-- SINGLE_STATEMENT_SENTINEL
-- CONDITIONALLY_REPEAT_MIGRATION_SENTINEL
WITH to_update AS (
  SELECT "tenancyId", "projectUserId"
  FROM "ProjectUser"
  WHERE "lastActiveAt" IS NULL
  LIMIT 1000
)
UPDATE "ProjectUser" pu
SET "lastActiveAt" = (
  SELECT MAX("eventStartedAt")
  FROM "Event"
  WHERE "Event"."data"->>'userId' = pu."projectUserId"::text
    AND "Event"."data"->>'projectId' = pu."mirroredProjectId"
    AND COALESCE("Event"."data"->>'branchId', 'main') = pu."mirroredBranchId"
    AND "Event"."systemEventTypeIds" @> '{"$user-activity"}'
)
FROM to_update
WHERE pu."tenancyId" = to_update."tenancyId"
  AND pu."projectUserId" = to_update."projectUserId"
RETURNING true AS should_repeat_migration;
