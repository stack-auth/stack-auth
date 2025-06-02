-- AlterEnum
ALTER TYPE "VerificationCodeType" RENAME VALUE 'NEON_INTEGRATION_PROJECT_TRANSFER' TO 'INTEGRATION_PROJECT_TRANSFER';

-- Rename table and constraints
ALTER TABLE "NeonProvisionedProject" RENAME TO "ProvisionedProject";
ALTER TABLE "ProvisionedProject" RENAME CONSTRAINT "NeonProvisionedProject_pkey" TO "ProvisionedProject_pkey";
ALTER TABLE "ProvisionedProject" RENAME CONSTRAINT "NeonProvisionedProject_projectId_fkey" TO "ProvisionedProject_projectId_fkey";
ALTER TABLE "ProvisionedProject" RENAME COLUMN "neonClientId" TO "clientId";
