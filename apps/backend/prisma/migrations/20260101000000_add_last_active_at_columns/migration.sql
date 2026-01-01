-- AlterTable
-- Add lastActiveAt column to ProjectUser table as nullable first (for backfill)
ALTER TABLE "ProjectUser" ADD COLUMN "lastActiveAt" TIMESTAMP(3);

-- AlterTable
-- Add lastActiveAt column to ProjectUserRefreshToken table as nullable first (for backfill)
ALTER TABLE "ProjectUserRefreshToken" ADD COLUMN "lastActiveAt" TIMESTAMP(3);

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- CONDITIONALLY_REPEAT_MIGRATION_SENTINEL
-- Backfill ProjectUser.lastActiveAt from Events table (using $user-activity events)
WITH to_update AS (
    SELECT pu."tenancyId", pu."projectUserId"
    FROM "ProjectUser" pu
    JOIN "Tenancy" t ON t."id" = pu."tenancyId"
    WHERE pu."lastActiveAt" IS NULL
    LIMIT 1000
),
event_activity AS (
    SELECT 
        t."id" AS "tenancyId",
        e."data"->>'userId' AS "userId",
        MAX(e."eventStartedAt") AS "lastActiveAt"
    FROM "Event" e
    JOIN "Tenancy" t ON t."projectId" = e."data"->>'projectId' 
                    AND t."branchId" = COALESCE(e."data"->>'branchId', 'main')
    WHERE '$user-activity' = ANY(e."systemEventTypeIds"::text[])
      AND e."data"->>'userId' IS NOT NULL
      AND EXISTS (SELECT 1 FROM to_update tu WHERE tu."tenancyId" = t."id" AND tu."projectUserId" = e."data"->>'userId')
    GROUP BY t."id", e."data"->>'userId'
),
updated AS (
    UPDATE "ProjectUser" pu
    SET "lastActiveAt" = COALESCE(ea."lastActiveAt", pu."createdAt")
    FROM to_update tu
    LEFT JOIN event_activity ea ON ea."tenancyId" = tu."tenancyId" AND ea."userId" = tu."projectUserId"
    WHERE pu."tenancyId" = tu."tenancyId" AND pu."projectUserId" = tu."projectUserId"
    RETURNING 1
)
SELECT COUNT(*) > 0 AS should_repeat_migration FROM updated;

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- CONDITIONALLY_REPEAT_MIGRATION_SENTINEL
-- Backfill ProjectUserRefreshToken.lastActiveAt from Events table (using $session-activity events)
WITH to_update AS (
    SELECT rt."tenancyId", rt."id"
    FROM "ProjectUserRefreshToken" rt
    JOIN "Tenancy" t ON t."id" = rt."tenancyId"
    WHERE rt."lastActiveAt" IS NULL
    LIMIT 1000
),
event_activity AS (
    SELECT 
        t."id" AS "tenancyId",
        e."data"->>'sessionId' AS "sessionId",
        MAX(e."eventStartedAt") AS "lastActiveAt"
    FROM "Event" e
    JOIN "Tenancy" t ON t."projectId" = e."data"->>'projectId' 
                    AND t."branchId" = COALESCE(e."data"->>'branchId', 'main')
    WHERE '$session-activity' = ANY(e."systemEventTypeIds"::text[])
      AND e."data"->>'sessionId' IS NOT NULL
      AND EXISTS (SELECT 1 FROM to_update tu WHERE tu."tenancyId" = t."id" AND tu."id" = e."data"->>'sessionId')
    GROUP BY t."id", e."data"->>'sessionId'
),
updated AS (
    UPDATE "ProjectUserRefreshToken" rt
    SET "lastActiveAt" = COALESCE(ea."lastActiveAt", rt."createdAt")
    FROM to_update tu
    LEFT JOIN event_activity ea ON ea."tenancyId" = tu."tenancyId" AND ea."sessionId" = tu."id"
    WHERE rt."tenancyId" = tu."tenancyId" AND rt."id" = tu."id"
    RETURNING 1
)
SELECT COUNT(*) > 0 AS should_repeat_migration FROM updated;

-- SPLIT_STATEMENT_SENTINEL
-- Make columns NOT NULL with default NOW() for new rows
ALTER TABLE "ProjectUser" ALTER COLUMN "lastActiveAt" SET NOT NULL;
ALTER TABLE "ProjectUser" ALTER COLUMN "lastActiveAt" SET DEFAULT NOW();

ALTER TABLE "ProjectUserRefreshToken" ALTER COLUMN "lastActiveAt" SET NOT NULL;
ALTER TABLE "ProjectUserRefreshToken" ALTER COLUMN "lastActiveAt" SET DEFAULT NOW();
