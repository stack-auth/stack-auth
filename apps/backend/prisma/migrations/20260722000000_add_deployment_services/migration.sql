-- CreateEnum
CREATE TYPE "DeploymentRunStatus" AS ENUM ('QUEUED', 'BUILDING', 'READY', 'ERROR', 'CANCELED');

-- CreateTable
CREATE TABLE "DeploymentService" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "serviceId" TEXT NOT NULL,
    "vercelProjectId" TEXT,
    "framework" TEXT,
    "installCommand" TEXT,
    "buildCommand" TEXT,
    "outputDirectory" TEXT,
    "rootDirectory" TEXT,

    CONSTRAINT "DeploymentService_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateTable
CREATE TABLE "DeploymentServiceDomain" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deploymentServiceId" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "verified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DeploymentServiceDomain_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateTable
CREATE TABLE "DeploymentRun" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deploymentServiceId" UUID NOT NULL,
    "vercelDeploymentId" TEXT,
    "vercelDeploymentUrl" TEXT,
    "status" "DeploymentRunStatus" NOT NULL DEFAULT 'QUEUED',
    "target" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "error" TEXT,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DeploymentRun_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateTable
CREATE TABLE "DeploymentSourceUpload" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "data" BYTEA,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeploymentSourceUpload_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentService_tenancyId_serviceId_key" ON "DeploymentService"("tenancyId", "serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentServiceDomain_tenancyId_deploymentServiceId_hostn_key" ON "DeploymentServiceDomain"("tenancyId", "deploymentServiceId", "hostname");

-- CreateIndex
CREATE INDEX "DeploymentRun_tenancyId_deploymentServiceId_createdAt_idx" ON "DeploymentRun"("tenancyId", "deploymentServiceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "DeploymentSourceUpload_expiresAt_idx" ON "DeploymentSourceUpload"("expiresAt");

-- AddForeignKey
ALTER TABLE "DeploymentService" ADD CONSTRAINT "DeploymentService_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentServiceDomain" ADD CONSTRAINT "DeploymentServiceDomain_tenancyId_deploymentServiceId_fkey" FOREIGN KEY ("tenancyId", "deploymentServiceId") REFERENCES "DeploymentService"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentRun" ADD CONSTRAINT "DeploymentRun_tenancyId_deploymentServiceId_fkey" FOREIGN KEY ("tenancyId", "deploymentServiceId") REFERENCES "DeploymentService"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentSourceUpload" ADD CONSTRAINT "DeploymentSourceUpload_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

