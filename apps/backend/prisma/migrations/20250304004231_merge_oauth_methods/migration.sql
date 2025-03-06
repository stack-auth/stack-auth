-- CreateEnum
CREATE TYPE "MergeOAuthMethods" AS ENUM ('LINK_METHOD', 'RAISE_ERROR', 'ALLOW_DUPLICATES');

-- AlterTable
ALTER TABLE "ProjectConfig" ADD COLUMN "mergeOAuthMethods" "MergeOAuthMethods" NOT NULL DEFAULT 'LINK_METHOD';
