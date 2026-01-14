-- AlterTable
-- Add lastActiveAt column to ProjectUser table as nullable first (for backfill)
ALTER TABLE "ProjectUser" ADD COLUMN "lastActiveAt" TIMESTAMP(3);

-- AlterTable
-- Add lastActiveAt and lastActiveAtIpInfo columns to ProjectUserRefreshToken table
ALTER TABLE "ProjectUserRefreshToken" ADD COLUMN "lastActiveAt" TIMESTAMP(3);
ALTER TABLE "ProjectUserRefreshToken" ADD COLUMN "lastActiveAtIpInfo" JSONB;
