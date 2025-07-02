-- DropForeignKey
ALTER TABLE "AuthMethod" DROP CONSTRAINT "AuthMethod_tenancyId_fkey";

-- DropForeignKey
ALTER TABLE "CliAuthAttempt" DROP CONSTRAINT "CliAuthAttempt_tenancyId_fkey";

-- DropForeignKey
ALTER TABLE "ConnectedAccount" DROP CONSTRAINT "ConnectedAccount_tenancyId_fkey";

-- DropForeignKey
ALTER TABLE "ContactChannel" DROP CONSTRAINT "ContactChannel_tenancyId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectApiKey" DROP CONSTRAINT "ProjectApiKey_tenancyId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectUser" DROP CONSTRAINT "ProjectUser_tenancyId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectUserAuthorizationCode" DROP CONSTRAINT "ProjectUserAuthorizationCode_tenancyId_projectUserId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectUserRefreshToken" DROP CONSTRAINT "ProjectUserRefreshToken_tenancyId_projectUserId_fkey";

-- DropForeignKey
ALTER TABLE "SentEmail" DROP CONSTRAINT "SentEmail_tenancyId_fkey";

-- DropForeignKey
ALTER TABLE "Team" DROP CONSTRAINT "Team_tenancyId_fkey";

-- AddForeignKey
ALTER TABLE "ProjectUserRefreshToken" ADD CONSTRAINT "ProjectUserRefreshToken_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectUserAuthorizationCode" ADD CONSTRAINT "ProjectUserAuthorizationCode_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
