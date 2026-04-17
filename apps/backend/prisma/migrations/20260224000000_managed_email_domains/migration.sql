CREATE TYPE "ManagedEmailDomainStatus" AS ENUM ('PENDING_DNS', 'PENDING_VERIFICATION', 'VERIFIED', 'APPLIED', 'FAILED');

CREATE TABLE "ManagedEmailDomain" (
  "id" UUID NOT NULL,
  "tenancyId" UUID NOT NULL,
  "projectId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "subdomain" TEXT NOT NULL,
  "senderLocalPart" TEXT NOT NULL,
  "resendDomainId" TEXT NOT NULL,
  "nameServerRecords" JSONB NOT NULL,
  "status" "ManagedEmailDomainStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
  "providerStatusRaw" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastError" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "lastWebhookAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ManagedEmailDomain_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManagedEmailDomain_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ManagedEmailDomain_resendDomainId_key" ON "ManagedEmailDomain"("resendDomainId");
CREATE UNIQUE INDEX "ManagedEmailDomain_tenancyId_subdomain_key" ON "ManagedEmailDomain"("tenancyId", "subdomain");
CREATE INDEX "ManagedEmailDomain_tenancy_status_active_idx" ON "ManagedEmailDomain"("tenancyId", "status", "isActive");
