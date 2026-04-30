-- CreateTable
CREATE TABLE "OidcFederationExchangeAudit" (
    "id" UUID NOT NULL,
    "tenancyId" UUID NOT NULL,
    "policyId" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OidcFederationExchangeAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OidcFederationExchangeAudit_tenancy_policy_createdAt_idx" ON "OidcFederationExchangeAudit"("tenancyId", "policyId", "createdAt" DESC);

-- Constrain outcome to the current vocabulary. `NOT VALID` skips the backfill scan for existing
-- rows; a follow-up migration can VALIDATE once we're confident all historical rows comply.
ALTER TABLE "OidcFederationExchangeAudit" ADD CONSTRAINT "OidcFederationExchangeAudit_outcome_check"
  CHECK ("outcome" IN ('success', 'failure')) NOT VALID;
