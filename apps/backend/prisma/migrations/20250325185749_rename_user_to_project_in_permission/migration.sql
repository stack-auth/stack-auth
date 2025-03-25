/*
  Warnings:

  - The values [USER] on the enum `PermissionScope` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `isDefaultUserPermission` on the `Permission` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "PermissionScope_new" AS ENUM ('PROJECT', 'TEAM');
ALTER TABLE "Permission" ALTER COLUMN "scope" TYPE "PermissionScope_new" USING ("scope"::text::"PermissionScope_new");
ALTER TYPE "PermissionScope" RENAME TO "PermissionScope_old";
ALTER TYPE "PermissionScope_new" RENAME TO "PermissionScope";
DROP TYPE "PermissionScope_old";
COMMIT;

-- AlterTable
ALTER TABLE "Permission" DROP COLUMN "isDefaultUserPermission",
ADD COLUMN     "isDefaultProjectPermission" BOOLEAN NOT NULL DEFAULT false;
