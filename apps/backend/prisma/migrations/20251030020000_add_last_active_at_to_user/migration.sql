-- Add lastActiveAt field to ProjectUser table to store last logged in timestamp
-- This replaces the need to query session activity events for this information
ALTER TABLE "ProjectUser" ADD COLUMN "lastActiveAt" TIMESTAMP(3);

-- Populate initial values from the latest session activity event for each user
-- This is a one-time data migration to backfill the new field
UPDATE "ProjectUser" SET "lastActiveAt" = (
  SELECT MAX("eventStartedAt")
  FROM "Event"
  WHERE "Event"."data"->>'userId' = "ProjectUser"."projectUserId"::text
    AND "Event"."data"->>'projectId' = "ProjectUser"."mirroredProjectId"
    AND COALESCE("Event"."data"->>'branchId', 'main') = "ProjectUser"."mirroredBranchId"
    AND "Event"."systemEventTypeIds" @> '{"$user-activity"}'
);
