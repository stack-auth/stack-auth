CREATE TYPE "AgentAuthRegistrationType" AS ENUM ('anonymous', 'service_auth');

CREATE TYPE "AgentAuthRegistrationStatus" AS ENUM ('pending', 'claimed', 'expired');

CREATE TABLE "AgentAuthRegistration" (
  "tenancyId" UUID NOT NULL,
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "type" "AgentAuthRegistrationType" NOT NULL,
  "status" "AgentAuthRegistrationStatus" NOT NULL DEFAULT 'pending',
  "loginHint" TEXT,
  "claimToken" TEXT NOT NULL,
  "claimAttemptToken" TEXT,
  "userCode" TEXT,
  "claimAttemptExpiresAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "userId" UUID,
  "refreshTokenId" UUID,
  "lastPollAt" TIMESTAMP(3),
  "usedAt" TIMESTAMP(3),
  "claimedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AgentAuthRegistration_pkey" PRIMARY KEY ("tenancyId","id")
);

CREATE UNIQUE INDEX "AgentAuthRegistration_claimToken_key" ON "AgentAuthRegistration"("claimToken");
CREATE UNIQUE INDEX "AgentAuthRegistration_claimAttemptToken_key" ON "AgentAuthRegistration"("claimAttemptToken");
CREATE INDEX "AgentAuthRegistration_tenancyId_expiresAt_idx" ON "AgentAuthRegistration"("tenancyId", "expiresAt");
CREATE INDEX "AgentAuthRegistration_tenancyId_claimAttemptExpiresAt_idx" ON "AgentAuthRegistration"("tenancyId", "claimAttemptExpiresAt");

ALTER TABLE "AgentAuthRegistration"
  ADD CONSTRAINT "AgentAuthRegistration_tenancyId_fkey"
  FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
