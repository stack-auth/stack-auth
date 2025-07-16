/*
  Warnings:

  - A unique constraint covering the columns `[tenancyId,projectUserId,configOAuthProviderId]` on the table `OAuthAuthMethod` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "OAuthAuthMethod_tenancyId_projectUserId_configOAuthProvider_key" ON "OAuthAuthMethod"("tenancyId", "projectUserId", "configOAuthProviderId");

-- DropForeignKey
ALTER TABLE "ConnectedAccount" DROP CONSTRAINT "ConnectedAccount_tenancyId_configOAuthProviderId_providerA_fkey";

-- DropForeignKey
ALTER TABLE "ConnectedAccount" DROP CONSTRAINT "ConnectedAccount_tenancyId_projectUserId_fkey";

-- DropForeignKey
ALTER TABLE "OAuthAccessToken" DROP CONSTRAINT "OAuthAccessToken_tenancyId_configOAuthProviderId_providerA_fkey";

-- DropForeignKey
ALTER TABLE "OAuthAuthMethod" DROP CONSTRAINT "OAuthAuthMethod_tenancyId_configOAuthProviderId_providerAc_fkey";

-- DropForeignKey
ALTER TABLE "OAuthToken" DROP CONSTRAINT "OAuthToken_tenancyId_configOAuthProviderId_providerAccount_fkey";

-- AlterTable
ALTER TABLE "ProjectUserOAuthAccount" DROP CONSTRAINT "ProjectUserOAuthAccount_pkey",
ADD COLUMN     "allowConnectedAccounts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "allowSignIn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "ProjectUserOAuthAccount_pkey" PRIMARY KEY ("tenancyId", "id");


-- AlterTable
ALTER TABLE "OAuthAccessToken" ADD COLUMN "oauthAccountId" UUID;


-- Update OAuthAccessToken.oauthAccountId with the corresponding ProjectUserOAuthAccount.id
UPDATE "OAuthAccessToken" 
SET "oauthAccountId" = "ProjectUserOAuthAccount"."id"
FROM "ProjectUserOAuthAccount" 
WHERE "OAuthAccessToken"."tenancyId" = "ProjectUserOAuthAccount"."tenancyId"
  AND "OAuthAccessToken"."configOAuthProviderId" = "ProjectUserOAuthAccount"."configOAuthProviderId"
  AND "OAuthAccessToken"."providerAccountId" = "ProjectUserOAuthAccount"."providerAccountId";

-- AlterTable
ALTER TABLE "OAuthAccessToken" DROP COLUMN "configOAuthProviderId", DROP COLUMN "providerAccountId";
ALTER TABLE "OAuthAccessToken" ALTER COLUMN "oauthAccountId" SET NOT NULL;

-- AlterTable
ALTER TABLE "OAuthToken" ADD COLUMN "oauthAccountId" UUID;

-- Update OAuthToken.oauthAccountId with the corresponding ProjectUserOAuthAccount.id
UPDATE "OAuthToken" 
SET "oauthAccountId" = "ProjectUserOAuthAccount"."id"
FROM "ProjectUserOAuthAccount" 
WHERE "OAuthToken"."tenancyId" = "ProjectUserOAuthAccount"."tenancyId"
  AND "OAuthToken"."configOAuthProviderId" = "ProjectUserOAuthAccount"."configOAuthProviderId"
  AND "OAuthToken"."providerAccountId" = "ProjectUserOAuthAccount"."providerAccountId";

ALTER TABLE "OAuthToken" DROP COLUMN "configOAuthProviderId", DROP COLUMN "providerAccountId";
ALTER TABLE "OAuthToken" ALTER COLUMN "oauthAccountId" SET NOT NULL;

-- DropTable
DROP TABLE "ConnectedAccount";

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAuthMethod_tenancyId_configOAuthProviderId_projectUser_key" ON "OAuthAuthMethod"("tenancyId", "configOAuthProviderId", "projectUserId", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectUserOAuthAccount_tenancyId_configOAuthProviderId_pro_key" ON "ProjectUserOAuthAccount"("tenancyId", "configOAuthProviderId", "projectUserId", "providerAccountId");

-- AddForeignKey
ALTER TABLE "OAuthAuthMethod" ADD CONSTRAINT "OAuthAuthMethod_tenancyId_configOAuthProviderId_projectUse_fkey" FOREIGN KEY ("tenancyId", "configOAuthProviderId", "projectUserId", "providerAccountId") REFERENCES "ProjectUserOAuthAccount"("tenancyId", "configOAuthProviderId", "projectUserId", "providerAccountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthToken" ADD CONSTRAINT "OAuthToken_tenancyId_oauthAccountId_fkey" FOREIGN KEY ("tenancyId", "oauthAccountId") REFERENCES "ProjectUserOAuthAccount"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthAccessToken" ADD CONSTRAINT "OAuthAccessToken_tenancyId_oauthAccountId_fkey" FOREIGN KEY ("tenancyId", "oauthAccountId") REFERENCES "ProjectUserOAuthAccount"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectUserOAuthAccount" ALTER COLUMN "projectUserId" DROP NOT NULL;
