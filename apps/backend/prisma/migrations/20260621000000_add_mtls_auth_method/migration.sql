-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.
-- (The new values are not used within this migration, so PostgreSQL 12+
-- accepts the ADD VALUE statements alongside the CREATE TABLE below.)


ALTER TYPE "VerificationCodeType" ADD VALUE 'MTLS_REGISTRATION_CHALLENGE';
ALTER TYPE "VerificationCodeType" ADD VALUE 'MTLS_AUTHENTICATION_CHALLENGE';

-- CreateTable
CREATE TABLE "MtlsAuthMethod" (
    "tenancyId" UUID NOT NULL,
    "authMethodId" UUID NOT NULL,
    "projectUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "certificatePem" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "keyAlgorithm" TEXT NOT NULL,
    "signatureAlgorithm" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "displayName" TEXT,

    CONSTRAINT "MtlsAuthMethod_pkey" PRIMARY KEY ("tenancyId","authMethodId")
);

-- CreateIndex
CREATE UNIQUE INDEX "MtlsAuthMethod_tenancyId_fingerprint_key" ON "MtlsAuthMethod"("tenancyId", "fingerprint");

-- CreateIndex
CREATE INDEX "MtlsAuthMethod_tenancyId_projectUserId_idx" ON "MtlsAuthMethod"("tenancyId", "projectUserId");

-- AddForeignKey
ALTER TABLE "MtlsAuthMethod" ADD CONSTRAINT "MtlsAuthMethod_tenancyId_authMethodId_fkey" FOREIGN KEY ("tenancyId", "authMethodId") REFERENCES "AuthMethod"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MtlsAuthMethod" ADD CONSTRAINT "MtlsAuthMethod_tenancyId_projectUserId_fkey" FOREIGN KEY ("tenancyId", "projectUserId") REFERENCES "ProjectUser"("tenancyId", "projectUserId") ON DELETE CASCADE ON UPDATE CASCADE;
