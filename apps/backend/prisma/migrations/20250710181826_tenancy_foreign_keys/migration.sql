-- DropForeignKey
ALTER TABLE "ProjectUserAuthorizationCode" DROP CONSTRAINT "ProjectUserAuthorizationCode_tenancyId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectUserRefreshToken" DROP CONSTRAINT "ProjectUserRefreshToken_tenancyId_fkey";

-- DropForeignKey
ALTER TABLE "UserNotificationPreference" DROP CONSTRAINT "UserNotificationPreference_tenancyId_fkey";
