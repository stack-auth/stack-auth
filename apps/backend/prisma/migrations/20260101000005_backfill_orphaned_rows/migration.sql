-- Handle orphaned rows (rows without a matching Tenancy) by setting lastActiveAt to createdAt
-- These rows can't be backfilled from Events since we need Tenancy to find the right project/branch
UPDATE "ProjectUser" pu
SET "lastActiveAt" = pu."createdAt"
WHERE pu."lastActiveAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Tenancy" t WHERE t."id" = pu."tenancyId");

UPDATE "ProjectUserRefreshToken" rt
SET "lastActiveAt" = rt."createdAt"
WHERE rt."lastActiveAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Tenancy" t WHERE t."id" = rt."tenancyId");

