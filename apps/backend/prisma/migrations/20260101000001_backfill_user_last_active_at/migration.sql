-- SINGLE_STATEMENT_SENTINEL
-- CONDITIONALLY_REPEAT_MIGRATION_SENTINEL
-- Backfill ProjectUser.lastActiveAt from Events table
-- Uses correlated subquery with existing index on (projectId, branchId, userId, eventStartedAt)
WITH to_update AS (
    SELECT pu."tenancyId", pu."projectUserId", t."projectId", t."branchId"
    FROM "ProjectUser" pu
    JOIN "Tenancy" t ON t."id" = pu."tenancyId"
    WHERE pu."lastActiveAt" IS NULL
    LIMIT 10000
),
updated AS (
    UPDATE "ProjectUser" pu
    SET "lastActiveAt" = COALESCE(
        (
            SELECT e."eventStartedAt"
            FROM "Event" e
            WHERE e."data"->>'projectId' = tu."projectId"
              AND COALESCE(e."data"->>'branchId', 'main') = tu."branchId"
              AND e."data"->>'userId' = tu."projectUserId"::text
            ORDER BY e."eventStartedAt" DESC
            LIMIT 1
        ),
        pu."createdAt"
    )
    FROM to_update tu
    WHERE pu."tenancyId" = tu."tenancyId" AND pu."projectUserId" = tu."projectUserId"
    RETURNING 1
)
SELECT COUNT(*) > 0 AS should_repeat_migration FROM updated;
