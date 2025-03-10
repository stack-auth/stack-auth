/*
  Warnings:

  - The primary key for the `ProjectUserRefreshToken` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The required column `id` was added to the `ProjectUserRefreshToken` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- AlterTable
ALTER TABLE "ProjectUserRefreshToken" DROP CONSTRAINT "ProjectUserRefreshToken_pkey",
ADD COLUMN     "id" UUID NOT NULL,
ADD COLUMN     "isImpersonation" BOOLEAN NOT NULL DEFAULT false,
ADD CONSTRAINT "ProjectUserRefreshToken_pkey" PRIMARY KEY ("tenancyId", "id");
