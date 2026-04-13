-- AlterTable
ALTER TABLE "CliAuthAttempt" ADD COLUMN     "anonRefreshToken" TEXT;

-- CreateIndex
CREATE INDEX "ProjectUser_signUpEmailNormalized_recent_idx" ON "ProjectUser"("tenancyId", "isAnonymous", "signUpEmailNormalized", "signedUpAt");

