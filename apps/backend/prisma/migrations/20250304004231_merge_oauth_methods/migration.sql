-- CreateEnum
CREATE TYPE "OAuthAccountMergeStrategy" AS ENUM ('LINK_METHOD', 'RAISE_ERROR', 'ALLOW_DUPLICATES');

-- AlterTable
ALTER TABLE "ProjectConfig" ADD COLUMN "oauthAccountMergeStrategy" "OAuthAccountMergeStrategy" NOT NULL DEFAULT 'LINK_METHOD';

-- Update existing projects to use the new strategy
UPDATE "ProjectConfig" SET "oauthAccountMergeStrategy" = 'ALLOW_DUPLICATES';
