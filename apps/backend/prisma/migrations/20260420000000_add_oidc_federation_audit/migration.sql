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
