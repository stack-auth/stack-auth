-- Backfill channel ownership in bounded batches. The migration runner repeats
-- this migration until each statement reports that no rows remain.
-- SINGLE_STATEMENT_SENTINEL
-- CONDITIONALLY_REPEAT_MIGRATION_SENTINEL
WITH to_backfill AS (
  SELECT "tenancyId", "projectUserId", "id"
  FROM "ContactChannel"
  WHERE "contactId" IS NULL
  ORDER BY "tenancyId", "projectUserId", "id"
  LIMIT 10000
  FOR UPDATE SKIP LOCKED
),
updated AS (
  UPDATE "ContactChannel" cc
  SET "contactId" = b."projectUserId"
  FROM to_backfill b
  WHERE cc."tenancyId" = b."tenancyId"
    AND cc."projectUserId" = b."projectUserId"
    AND cc."id" = b."id"
  RETURNING 1
)
SELECT EXISTS (
  SELECT 1 FROM "ContactChannel" WHERE "contactId" IS NULL
) AS should_repeat_migration;
-- SPLIT_STATEMENT_SENTINEL

-- Preserve legacy authentication selections without scanning or writing the
-- entire ContactChannel table in one transaction.
-- SINGLE_STATEMENT_SENTINEL
-- CONDITIONALLY_REPEAT_MIGRATION_SENTINEL
WITH to_backfill AS (
  SELECT
    cc."tenancyId",
    cc."projectUserId",
    cc."id" AS "contactChannelId",
    cc."type",
    cc."identityScope",
    cc."value"
  FROM "ContactChannel" cc
  WHERE cc."usedForAuth" = 'TRUE'
    AND NOT EXISTS (
      SELECT 1
      FROM "ProjectUserAuthContactChannel" auth
      WHERE auth."tenancyId" = cc."tenancyId"
        AND auth."projectUserId" = cc."projectUserId"
        AND auth."contactChannelId" = cc."id"
    )
  ORDER BY cc."tenancyId", cc."projectUserId", cc."id"
  LIMIT 10000
  FOR UPDATE OF cc SKIP LOCKED
),
inserted AS (
  INSERT INTO "ProjectUserAuthContactChannel" (
    "tenancyId",
    "projectUserId",
    "contactChannelId",
    "createdAt",
    "updatedAt",
    "type",
    "identityScope",
    "value"
  )
  SELECT
    "tenancyId",
    "projectUserId",
    "contactChannelId",
    NOW(),
    NOW(),
    "type",
    "identityScope",
    "value"
  FROM to_backfill
  ON CONFLICT ("tenancyId", "projectUserId", "contactChannelId") DO NOTHING
  RETURNING 1
)
SELECT EXISTS (
  SELECT 1
  FROM "ContactChannel" cc
  WHERE cc."usedForAuth" = 'TRUE'
    AND NOT EXISTS (
      SELECT 1
      FROM "ProjectUserAuthContactChannel" auth
      WHERE auth."tenancyId" = cc."tenancyId"
        AND auth."projectUserId" = cc."projectUserId"
        AND auth."contactChannelId" = cc."id"
    )
) AS should_repeat_migration;
