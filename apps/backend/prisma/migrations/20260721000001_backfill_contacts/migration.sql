-- SINGLE_STATEMENT_SENTINEL
-- CONDITIONALLY_REPEAT_MIGRATION_SENTINEL
WITH to_backfill AS (
  SELECT "tenancyId", "projectUserId", "createdAt", "updatedAt",
         "displayName", "profileImageUrl", "clientMetadata",
         "clientReadOnlyMetadata", "serverMetadata"
  FROM "ProjectUser" pu
  WHERE pu."temp_contact_backfilled" IS NOT TRUE
  ORDER BY pu."tenancyId", pu."projectUserId"
  LIMIT 10000
  FOR UPDATE OF pu SKIP LOCKED
),
inserted AS (
  INSERT INTO "Contact" (
    "tenancyId", "id", "createdAt", "updatedAt",
    "displayName", "profileImageUrl", "clientMetadata",
    "clientReadOnlyMetadata", "serverMetadata",
    "shouldUpdateSequenceId"
  )
  SELECT
    tb."tenancyId", tb."projectUserId", tb."createdAt", tb."updatedAt",
    tb."displayName", tb."profileImageUrl", tb."clientMetadata",
    tb."clientReadOnlyMetadata", tb."serverMetadata",
    TRUE
  FROM to_backfill tb
  ON CONFLICT ("tenancyId", "id") DO NOTHING
  RETURNING "tenancyId", "id"
),
updated AS (
  UPDATE "ProjectUser" pu
  SET "temp_contact_backfilled" = TRUE
  FROM to_backfill tb
  WHERE pu."tenancyId" = tb."tenancyId"
    AND pu."projectUserId" = tb."projectUserId"
  RETURNING 1
)
SELECT EXISTS (
  SELECT 1
  FROM "ProjectUser"
  WHERE "temp_contact_backfilled" IS NOT TRUE
) AS should_repeat_migration;
