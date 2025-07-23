-- AlterTable
ALTER TABLE "OAuthAccessToken" ADD COLUMN     "isValid" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "OAuthToken" ADD COLUMN     "isValid" BOOLEAN NOT NULL DEFAULT true;
