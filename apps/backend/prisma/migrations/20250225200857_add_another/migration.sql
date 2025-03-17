-- DropForeignKey
ALTER TABLE "SentEmail" DROP CONSTRAINT "SentEmail_tenancyId_userId_fkey";

-- AddForeignKey
ALTER TABLE "SentEmail" ADD CONSTRAINT "SentEmail_tenancyId_userId_fkey" FOREIGN KEY ("tenancyId", "userId") REFERENCES "ProjectUser"("tenancyId", "projectUserId") ON DELETE CASCADE ON UPDATE CASCADE;
