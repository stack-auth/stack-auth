-- DropForeignKey
ALTER TABLE "SentEmail" DROP CONSTRAINT "SentEmail_tenancyId_fkey";

-- AddForeignKey
ALTER TABLE "SentEmail" ADD CONSTRAINT "SentEmail_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
