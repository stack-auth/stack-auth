/*
  Warnings:

  x You are about to drop the column `oauthProviderConfigId` on the `ConnectedAccount` table. All the data in the column will be lost.
    x Added the required column `configOAuthProviderId` to the `ConnectedAccount` table without a default value. This is not possible if the table is not empty.
  x You are about to drop the column `oAuthProviderConfigId` on the `OAuthAccessToken` table. All the data in the column will be lost.
    x Added the required column `configOAuthProviderId` to the `OAuthAccessToken` table without a default value. This is not possible if the table is not empty.
  x You are about to drop the column `oauthProviderConfigId` on the `OAuthAuthMethod` table. All the data in the column will be lost.
    x Added the required column `configOAuthProviderId` to the `OAuthAuthMethod` table without a default value. This is not possible if the table is not empty.
  x You are about to drop the column `oAuthProviderConfigId` on the `OAuthToken` table. All the data in the column will be lost.
    x Added the required column `configOAuthProviderId` to the `OAuthToken` table without a default value. This is not possible if the table is not empty.
  x You are about to drop the column `oauthProviderConfigId` on the `ProjectUserOAuthAccount` table. All the data in the column will be lost.
    x Added the required column `configOAuthProviderId` to the `ProjectUserOAuthAccount` table without a default value. This is not possible if the table is not empty.

  x You are about to drop the column `permissionDbId` on the `ProjectUserDirectPermission` table. All the data in the column will be lost.
  x Added the required column `permissionId` to the `ProjectUserDirectPermission` table without a default value. This is not possible if the table is not empty.

  x You are about to drop the column `permissionDbId` on the `TeamMemberDirectPermission` table. All the data in the column will be lost.
  x You are about to drop the column `systemPermission` on the `TeamMemberDirectPermission` table. All the data in the column will be lost.
  x Added the required column `permissionId` to the `TeamMemberDirectPermission` table without a default value. This is not possible if the table is not empty.

  x Added the required column `projectId` to the `EmailTemplate` table without a default value. This is not possible if the table is not empty.
  x You are about to drop the column `projectConfigId` on the `EmailTemplate` table. All the data in the column will be lost.



  x You are about to drop the column `authMethodConfigId` on the `AuthMethod` table. All the data in the column will be lost.
  x You are about to drop the column `connectedAccountConfigId` on the `ConnectedAccount` table. All the data in the column will be lost.
  x You are about to drop the column `configId` on the `Project` table. All the data in the column will be lost.
  x You are about to drop the column `projectConfigId` on the `AuthMethod` table. All the data in the column will be lost.
  x You are about to drop the column `projectConfigId` on the `ConnectedAccount` table. All the data in the column will be lost.
  x The primary key for the `EmailTemplate` table will be changed. If it partially fails, the table could be left without primary key constraint.
  x You are about to drop the column `projectConfigId` on the `OAuthAuthMethod` table. All the data in the column will be lost.
  x The primary key for the `ProjectUserOAuthAccount` table will be changed. If it partially fails, the table could be left without primary key constraint.
  x You are about to drop the column `projectConfigId` on the `ProjectUserOAuthAccount` table. All the data in the column will be lost.
  x You are about to drop the `AuthMethodConfig` table. If the table is not empty, all the data it contains will be lost.
  x You are about to drop the `ConnectedAccountConfig` table. If the table is not empty, all the data it contains will be lost.
  x You are about to drop the `EmailServiceConfig` table. If the table is not empty, all the data it contains will be lost.
  x You are about to drop the `OAuthProviderConfig` table. If the table is not empty, all the data it contains will be lost.
  x You are about to drop the `OtpAuthMethodConfig` table. If the table is not empty, all the data it contains will be lost.
  x You are about to drop the `PasskeyAuthMethodConfig` table. If the table is not empty, all the data it contains will be lost.
  x You are about to drop the `PasswordAuthMethodConfig` table. If the table is not empty, all the data it contains will be lost.
  x You are about to drop the `Permission` table. If the table is not empty, all the data it contains will be lost.
  x You are about to drop the `PermissionEdge` table. If the table is not empty, all the data it contains will be lost.
  x You are about to drop the `ProjectConfig` table. If the table is not empty, all the data it contains will be lost.
  x You are about to drop the `ProjectDomain` table. If the table is not empty, all the data it contains will be lost.
  x You are about to drop the `ProxiedEmailServiceConfig` table. If the table is not empty, all the data it contains will be lost.
  x You are about to drop the `ProxiedOAuthProviderConfig` table. If the table is not empty, all the data it contains will be lost.
  x You are about to drop the `StandardEmailServiceConfig` table. If the table is not empty, all the data it contains will be lost.
  x You are about to drop the `StandardOAuthProviderConfig` table. If the table is not empty, all the data it contains will be lost.
  x A unique constraint covering the columns `[tenancyId,configOAuthProviderId,providerAccountId]` on the table `ConnectedAccount` will be added. If there are existing duplicate values, this will fail.
  x A unique constraint covering the columns `[tenancyId,configOAuthProviderId,providerAccountId]` on the table `OAuthAuthMethod` will be added. If there are existing duplicate values, this will fail.
  x A unique constraint covering the columns `[tenancyId,projectUserId,permissionId]` on the table `ProjectUserDirectPermission` will be added. If there are existing duplicate values, this will fail.
  x A unique constraint covering the columns `[tenancyId,projectUserId,teamId,permissionId]` on the table `TeamMemberDirectPermission` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "AuthMethod" DROP CONSTRAINT "AuthMethod_projectConfigId_authMethodConfigId_fkey";

-- DropForeignKey
ALTER TABLE "AuthMethodConfig" DROP CONSTRAINT "AuthMethodConfig_projectConfigId_fkey";

-- DropForeignKey
ALTER TABLE "ConnectedAccount" DROP CONSTRAINT "ConnectedAccount_projectConfigId_connectedAccountConfigId_fkey";

-- DropForeignKey
ALTER TABLE "ConnectedAccount" DROP CONSTRAINT "ConnectedAccount_projectConfigId_oauthProviderConfigId_fkey";

-- DropForeignKey
ALTER TABLE "ConnectedAccount" DROP CONSTRAINT "ConnectedAccount_tenancyId_oauthProviderConfigId_providerA_fkey";

-- DropForeignKey
ALTER TABLE "ConnectedAccountConfig" DROP CONSTRAINT "ConnectedAccountConfig_projectConfigId_fkey";

-- DropForeignKey
ALTER TABLE "EmailServiceConfig" DROP CONSTRAINT "EmailServiceConfig_projectConfigId_fkey";

-- DropForeignKey
ALTER TABLE "EmailTemplate" DROP CONSTRAINT "EmailTemplate_projectConfigId_fkey";

-- DropForeignKey
ALTER TABLE "OAuthAccessToken" DROP CONSTRAINT "OAuthAccessToken_tenancyId_oAuthProviderConfigId_providerA_fkey";

-- DropForeignKey
ALTER TABLE "OAuthAuthMethod" DROP CONSTRAINT "OAuthAuthMethod_projectConfigId_oauthProviderConfigId_fkey";

-- DropForeignKey
ALTER TABLE "OAuthAuthMethod" DROP CONSTRAINT "OAuthAuthMethod_tenancyId_oauthProviderConfigId_providerAc_fkey";

-- DropForeignKey
ALTER TABLE "OAuthProviderConfig" DROP CONSTRAINT "OAuthProviderConfig_projectConfigId_authMethodConfigId_fkey";

-- DropForeignKey
ALTER TABLE "OAuthProviderConfig" DROP CONSTRAINT "OAuthProviderConfig_projectConfigId_connectedAccountConfig_fkey";

-- DropForeignKey
ALTER TABLE "OAuthProviderConfig" DROP CONSTRAINT "OAuthProviderConfig_projectConfigId_fkey";

-- DropForeignKey
ALTER TABLE "OAuthToken" DROP CONSTRAINT "OAuthToken_tenancyId_oAuthProviderConfigId_providerAccount_fkey";

-- DropForeignKey
ALTER TABLE "OtpAuthMethodConfig" DROP CONSTRAINT "OtpAuthMethodConfig_projectConfigId_authMethodConfigId_fkey";

-- DropForeignKey
ALTER TABLE "PasskeyAuthMethodConfig" DROP CONSTRAINT "PasskeyAuthMethodConfig_projectConfigId_authMethodConfigId_fkey";

-- DropForeignKey
ALTER TABLE "PasswordAuthMethodConfig" DROP CONSTRAINT "PasswordAuthMethodConfig_projectConfigId_authMethodConfigI_fkey";

-- DropForeignKey
ALTER TABLE "Permission" DROP CONSTRAINT "Permission_projectConfigId_fkey";

-- DropForeignKey
ALTER TABLE "Permission" DROP CONSTRAINT "Permission_tenancyId_teamId_fkey";

-- DropForeignKey
ALTER TABLE "PermissionEdge" DROP CONSTRAINT "PermissionEdge_childPermissionDbId_fkey";

-- DropForeignKey
ALTER TABLE "PermissionEdge" DROP CONSTRAINT "PermissionEdge_parentPermissionDbId_fkey";

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_configId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectDomain" DROP CONSTRAINT "ProjectDomain_projectConfigId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectUserDirectPermission" DROP CONSTRAINT "ProjectUserDirectPermission_permissionDbId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectUserOAuthAccount" DROP CONSTRAINT "ProjectUserOAuthAccount_projectConfigId_oauthProviderConfi_fkey";

-- DropForeignKey
ALTER TABLE "ProxiedEmailServiceConfig" DROP CONSTRAINT "ProxiedEmailServiceConfig_projectConfigId_fkey";

-- DropForeignKey
ALTER TABLE "ProxiedOAuthProviderConfig" DROP CONSTRAINT "ProxiedOAuthProviderConfig_projectConfigId_id_fkey";

-- DropForeignKey
ALTER TABLE "StandardEmailServiceConfig" DROP CONSTRAINT "StandardEmailServiceConfig_projectConfigId_fkey";

-- DropForeignKey
ALTER TABLE "StandardOAuthProviderConfig" DROP CONSTRAINT "StandardOAuthProviderConfig_projectConfigId_id_fkey";

-- DropForeignKey
ALTER TABLE "TeamMemberDirectPermission" DROP CONSTRAINT "TeamMemberDirectPermission_permissionDbId_fkey";

-- DropIndex
DROP INDEX "ConnectedAccount_tenancyId_oauthProviderConfigId_providerAc_key";

-- DropIndex
DROP INDEX "OAuthAuthMethod_tenancyId_oauthProviderConfigId_providerAcc_key";

-- DropIndex
DROP INDEX "ProjectUserDirectPermission_tenancyId_projectUserId_permiss_key";

-- DropIndex
DROP INDEX "TeamMemberDirectPermission_tenancyId_projectUserId_teamId_p_key";

-- DropIndex
DROP INDEX "TeamMemberDirectPermission_tenancyId_projectUserId_teamId_s_key";

-- AlterTable
ALTER TABLE "AuthMethod" DROP COLUMN "authMethodConfigId",
DROP COLUMN "projectConfigId";

-- AlterTable
BEGIN;
ALTER TABLE "ConnectedAccount" ADD COLUMN "configOAuthProviderId" TEXT;
UPDATE "ConnectedAccount" SET "configOAuthProviderId" = "oauthProviderConfigId";
ALTER TABLE "ConnectedAccount" ALTER COLUMN "configOAuthProviderId" SET NOT NULL;
ALTER TABLE "ConnectedAccount" DROP COLUMN "oauthProviderConfigId";
ALTER TABLE "ConnectedAccount" DROP COLUMN "connectedAccountConfigId";
ALTER TABLE "ConnectedAccount" DROP COLUMN "projectConfigId";
COMMIT;

-- AlterTable
BEGIN;
ALTER TABLE "EmailTemplate" DROP CONSTRAINT "EmailTemplate_pkey";
ALTER TABLE "EmailTemplate" ADD COLUMN "projectId" TEXT;

-- Update projectId with values from Project through ProjectConfig join
UPDATE "EmailTemplate" ET
SET "projectId" = P."id"
FROM "ProjectConfig" PC
JOIN "Project" P ON P."configId" = PC."id"
WHERE ET."projectConfigId" = PC."id";

-- Check if we have any null projectId values
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "EmailTemplate" WHERE "projectId" IS NULL) THEN
        RAISE EXCEPTION 'Some EmailTemplate records have null projectId values after migration';
    END IF;
END $$;

-- Now make the column NOT NULL
ALTER TABLE "EmailTemplate" ALTER COLUMN "projectId" SET NOT NULL;

-- Add the primary key constraint
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("projectId", "type");

-- Drop the old column
ALTER TABLE "EmailTemplate" DROP COLUMN "projectConfigId";
COMMIT;

-- AlterTable
BEGIN;
ALTER TABLE "OAuthAccessToken" ADD COLUMN "configOAuthProviderId" TEXT;
UPDATE "OAuthAccessToken" SET "configOAuthProviderId" = "oAuthProviderConfigId";
ALTER TABLE "OAuthAccessToken" ALTER COLUMN "configOAuthProviderId" SET NOT NULL;
ALTER TABLE "OAuthAccessToken" DROP COLUMN "oAuthProviderConfigId";
COMMIT;

-- AlterTable
BEGIN;
ALTER TABLE "OAuthAuthMethod" ADD COLUMN "configOAuthProviderId" TEXT;
UPDATE "OAuthAuthMethod" SET "configOAuthProviderId" = "oauthProviderConfigId";
ALTER TABLE "OAuthAuthMethod" ALTER COLUMN "configOAuthProviderId" SET NOT NULL;
ALTER TABLE "OAuthAuthMethod" DROP COLUMN "oauthProviderConfigId";
ALTER TABLE "OAuthAuthMethod" DROP COLUMN "projectConfigId";
COMMIT;

-- AlterTable
BEGIN;
ALTER TABLE "OAuthToken" ADD COLUMN "configOAuthProviderId" TEXT;
UPDATE "OAuthToken" SET "configOAuthProviderId" = "oAuthProviderConfigId";
ALTER TABLE "OAuthToken" ALTER COLUMN "configOAuthProviderId" SET NOT NULL;
ALTER TABLE "OAuthToken" DROP COLUMN "oAuthProviderConfigId";
COMMIT;

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "configId";

-- AlterTable
BEGIN;
ALTER TABLE "ProjectUserDirectPermission" ADD COLUMN "permissionId" TEXT;

-- Update permissionId with values from Permission table
UPDATE "ProjectUserDirectPermission"
SET "permissionId" = "Permission"."queryableId"
FROM "Permission"
WHERE "ProjectUserDirectPermission"."permissionDbId" = "Permission"."dbId";

-- Now make the column NOT NULL
ALTER TABLE "ProjectUserDirectPermission" ALTER COLUMN "permissionId" SET NOT NULL;

-- Drop the old column
ALTER TABLE "ProjectUserDirectPermission" DROP COLUMN "permissionDbId";
COMMIT;

-- AlterTable
BEGIN;
ALTER TABLE "ProjectUserOAuthAccount" ADD COLUMN "configOAuthProviderId" TEXT;
UPDATE "ProjectUserOAuthAccount" SET "configOAuthProviderId" = "oauthProviderConfigId";
ALTER TABLE "ProjectUserOAuthAccount" ALTER COLUMN "configOAuthProviderId" SET NOT NULL;
ALTER TABLE "ProjectUserOAuthAccount" DROP CONSTRAINT "ProjectUserOAuthAccount_pkey";
ALTER TABLE "ProjectUserOAuthAccount" DROP COLUMN "oauthProviderConfigId";
ALTER TABLE "ProjectUserOAuthAccount" DROP COLUMN "projectConfigId";
ALTER TABLE "ProjectUserOAuthAccount" ADD CONSTRAINT "ProjectUserOAuthAccount_pkey" PRIMARY KEY ("tenancyId", "configOAuthProviderId", "providerAccountId");
COMMIT;

-- AlterTable
BEGIN;
ALTER TABLE "TeamMemberDirectPermission" ADD COLUMN "permissionId" TEXT;

-- Check for rows where both or neither field is populated
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "TeamMemberDirectPermission"
        WHERE ("permissionDbId" IS NULL AND "systemPermission" IS NULL) 
           OR ("permissionDbId" IS NOT NULL AND "systemPermission" IS NOT NULL)
    ) THEN
        RAISE EXCEPTION 'Invalid state: Each TeamMemberDirectPermission must have exactly one of permissionDbId or systemPermission set';
    END IF;
END $$;

-- Update permissionId using systemPermission when available
UPDATE "TeamMemberDirectPermission"
SET "permissionId" = '$' || LOWER("systemPermission"::TEXT)
WHERE "systemPermission" IS NOT NULL;

-- Update permissionId using Permission.queryableId when permissionDbId is available
UPDATE "TeamMemberDirectPermission"
SET "permissionId" = "Permission"."queryableId"
FROM "Permission"
WHERE "TeamMemberDirectPermission"."permissionDbId" = "Permission"."dbId";

-- Now make the column NOT NULL
ALTER TABLE "TeamMemberDirectPermission" ALTER COLUMN "permissionId" SET NOT NULL;

-- Then drop the old columns
ALTER TABLE "TeamMemberDirectPermission" DROP COLUMN "permissionDbId";
ALTER TABLE "TeamMemberDirectPermission" DROP COLUMN "systemPermission";
COMMIT;

-- DropTable
DROP TABLE "AuthMethodConfig";

-- DropTable
DROP TABLE "ConnectedAccountConfig";

-- DropTable
DROP TABLE "EmailServiceConfig";

-- DropTable
DROP TABLE "OAuthProviderConfig";

-- DropTable
DROP TABLE "OtpAuthMethodConfig";

-- DropTable
DROP TABLE "PasskeyAuthMethodConfig";

-- DropTable
DROP TABLE "PasswordAuthMethodConfig";

-- DropTable
DROP TABLE "Permission";

-- DropTable
DROP TABLE "PermissionEdge";

-- DropTable
DROP TABLE "ProjectConfig";

-- DropTable
DROP TABLE "ProjectDomain";

-- DropTable
DROP TABLE "ProxiedEmailServiceConfig";

-- DropTable
DROP TABLE "ProxiedOAuthProviderConfig";

-- DropTable
DROP TABLE "StandardEmailServiceConfig";

-- DropTable
DROP TABLE "StandardOAuthProviderConfig";

-- DropEnum
DROP TYPE "PermissionScope";

-- DropEnum
DROP TYPE "TeamSystemPermission";

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedAccount_tenancyId_configOAuthProviderId_providerAc_key" ON "ConnectedAccount"("tenancyId", "configOAuthProviderId", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAuthMethod_tenancyId_configOAuthProviderId_providerAcc_key" ON "OAuthAuthMethod"("tenancyId", "configOAuthProviderId", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectUserDirectPermission_tenancyId_projectUserId_permiss_key" ON "ProjectUserDirectPermission"("tenancyId", "projectUserId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMemberDirectPermission_tenancyId_projectUserId_teamId_p_key" ON "TeamMemberDirectPermission"("tenancyId", "projectUserId", "teamId", "permissionId");

-- AddForeignKey
ALTER TABLE "ConnectedAccount" ADD CONSTRAINT "ConnectedAccount_tenancyId_configOAuthProviderId_providerA_fkey" FOREIGN KEY ("tenancyId", "configOAuthProviderId", "providerAccountId") REFERENCES "ProjectUserOAuthAccount"("tenancyId", "configOAuthProviderId", "providerAccountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthAuthMethod" ADD CONSTRAINT "OAuthAuthMethod_tenancyId_configOAuthProviderId_providerAc_fkey" FOREIGN KEY ("tenancyId", "configOAuthProviderId", "providerAccountId") REFERENCES "ProjectUserOAuthAccount"("tenancyId", "configOAuthProviderId", "providerAccountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthToken" ADD CONSTRAINT "OAuthToken_tenancyId_configOAuthProviderId_providerAccount_fkey" FOREIGN KEY ("tenancyId", "configOAuthProviderId", "providerAccountId") REFERENCES "ProjectUserOAuthAccount"("tenancyId", "configOAuthProviderId", "providerAccountId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthAccessToken" ADD CONSTRAINT "OAuthAccessToken_tenancyId_configOAuthProviderId_providerA_fkey" FOREIGN KEY ("tenancyId", "configOAuthProviderId", "providerAccountId") REFERENCES "ProjectUserOAuthAccount"("tenancyId", "configOAuthProviderId", "providerAccountId") ON DELETE CASCADE ON UPDATE CASCADE;
