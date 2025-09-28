/*
  Warnings:

  - Added the required column `customerType` to the `ItemQuantityChange` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ItemQuantityChange" ADD COLUMN "customerType" "CustomerType";

UPDATE "ItemQuantityChange" AS iqc
SET "customerType" = 'USER'
FROM "ProjectUser" AS pu
WHERE iqc."tenancyId" = pu."tenancyId"
  AND iqc."customerId" = pu."projectUserId"::text;

UPDATE "ItemQuantityChange" AS iqc
SET "customerType" = 'TEAM'
FROM "Team" AS t
WHERE iqc."customerType" IS NULL
  AND iqc."tenancyId" = t."tenancyId"
  AND iqc."customerId" = t."teamId"::text;

UPDATE "ItemQuantityChange"
SET "customerType" = 'CUSTOM'
WHERE "customerType" IS NULL;

ALTER TABLE "ItemQuantityChange" ALTER COLUMN "customerType" SET NOT NULL;
