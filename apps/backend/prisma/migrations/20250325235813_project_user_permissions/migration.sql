/*
  Warnings:

  - The values [USER] on the enum `PermissionScope` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
CREATE TYPE "PermissionScope_new" AS ENUM ('PROJECT', 'TEAM');
ALTER TABLE "Permission" ALTER COLUMN "scope" TYPE "PermissionScope_new" USING ("scope"::text::"PermissionScope_new");
ALTER TYPE "PermissionScope" RENAME TO "PermissionScope_old";
ALTER TYPE "PermissionScope_new" RENAME TO "PermissionScope";
DROP TYPE "PermissionScope_old";
-- SPLIT_STATEMENT_SENTINEL

-- AlterTable
ALTER TABLE "Permission" ADD COLUMN     "isDefaultProjectPermission" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProjectUserDirectPermission" (
    "id" UUID NOT NULL,
    "tenancyId" UUID NOT NULL,
    "projectUserId" UUID NOT NULL,
    "permissionDbId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectUserDirectPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectUserDirectPermission_tenancyId_projectUserId_permiss_key" ON "ProjectUserDirectPermission"("tenancyId", "projectUserId", "permissionDbId");

-- AddForeignKey
ALTER TABLE "ProjectUserDirectPermission" ADD CONSTRAINT "ProjectUserDirectPermission_tenancyId_projectUserId_fkey" FOREIGN KEY ("tenancyId", "projectUserId") REFERENCES "ProjectUser"("tenancyId", "projectUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectUserDirectPermission" ADD CONSTRAINT "ProjectUserDirectPermission_permissionDbId_fkey" FOREIGN KEY ("permissionDbId") REFERENCES "Permission"("dbId") ON DELETE CASCADE ON UPDATE CASCADE;
