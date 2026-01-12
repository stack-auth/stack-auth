-- SINGLE_STATEMENT_SENTINEL
-- CONDITIONALLY_REPEAT_MIGRATION_SENTINEL
-- Backfill ProjectUserRefreshToken.lastActiveAt and lastActiveAtIpInfo from Events table
-- Uses correlated subquery with temporary index on (projectId, COALESCE(branchId, 'main'), userId, sessionId, eventStartedAt DESC)
WITH to_update AS (
    SELECT rt."tenancyId", rt."id", rt."projectUserId", t."projectId", t."branchId"
    FROM "ProjectUserRefreshToken" rt
    JOIN "Tenancy" t ON t."id" = rt."tenancyId"
    WHERE rt."lastActiveAt" IS NULL
    LIMIT 10000
),
updated AS (
    UPDATE "ProjectUserRefreshToken" rt
    SET "lastActiveAt" = COALESCE(
        (
            SELECT e."eventStartedAt"
            FROM "Event" e
            WHERE e."data"->>'projectId' = tu."projectId"
              AND COALESCE(e."data"->>'branchId', 'main') = tu."branchId"
              AND e."data"->>'userId' = tu."projectUserId"::text
              AND e."data"->>'sessionId' = tu."id"::text
            ORDER BY e."eventStartedAt" DESC
            LIMIT 1
        ),
        rt."createdAt"
    ),
    "lastActiveAtIpInfo" = (
        SELECT CASE 
            WHEN eip."id" IS NOT NULL THEN jsonb_build_object(
                'ip', eip."ip",
                'countryCode', eip."countryCode",
                'regionCode', eip."regionCode",
                'cityName', eip."cityName",
                'latitude', eip."latitude",
                'longitude', eip."longitude",
                'tzIdentifier', eip."tzIdentifier"
            )
            ELSE NULL
        END
        FROM "Event" e
        LEFT JOIN "EventIpInfo" eip ON eip."id" = e."endUserIpInfoGuessId"
        WHERE e."data"->>'projectId' = tu."projectId"
          AND COALESCE(e."data"->>'branchId', 'main') = tu."branchId"
          AND e."data"->>'userId' = tu."projectUserId"::text
          AND e."data"->>'sessionId' = tu."id"::text
        ORDER BY e."eventStartedAt" DESC
        LIMIT 1
    )
    FROM to_update tu
    WHERE rt."tenancyId" = tu."tenancyId" AND rt."id" = tu."id"
    RETURNING 1
)
SELECT COUNT(*) > 0 AS should_repeat_migration FROM updated;
