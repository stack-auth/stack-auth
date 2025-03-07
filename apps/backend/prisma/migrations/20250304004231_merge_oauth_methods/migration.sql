-- CreateEnum
CREATE TYPE "OAuthAccountMergeStrategy" AS ENUM ('LINK_METHOD', 'RAISE_ERROR', 'ALLOW_DUPLICATES');

-- AlterTable
ALTER TABLE "ProjectConfig" ADD COLUMN "oauthAccountMergeStrategy" "OauthAccountMergeStrategy" NOT NULL DEFAULT 'LINK_METHOD';
