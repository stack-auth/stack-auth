/*
  Warnings:

  - The primary key for the `ProjectUserRefreshToken` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The required column `id` was added to the `ProjectUserRefreshToken` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- AlterTable
ALTER TABLE "ProjectUserRefreshToken"
ADD COLUMN     "id" UUID,
ADD COLUMN     "isImpersonation" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ProjectUserRefreshToken" SET "id" = gen_random_uuid();

ALTER TABLE "ProjectUserRefreshToken" DROP CONSTRAINT "ProjectUserRefreshToken_pkey",
ALTER COLUMN "id" SET NOT NULL,
ADD CONSTRAINT "ProjectUserRefreshToken_pkey" PRIMARY KEY ("tenancyId", "id");
