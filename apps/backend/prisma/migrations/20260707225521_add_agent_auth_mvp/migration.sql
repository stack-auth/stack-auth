-- CreateEnum
CREATE TYPE "AgentHostStatus" AS ENUM ('ACTIVE', 'PENDING', 'REVOKED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AgentMode" AS ENUM ('DELEGATED', 'AUTONOMOUS');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED', 'REJECTED', 'CLAIMED');

-- CreateEnum
CREATE TYPE "AgentCapabilityGrantStatus" AS ENUM ('ACTIVE', 'PENDING', 'DENIED');

-- CreateTable
CREATE TABLE "AgentHost" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "projectUserId" UUID,
    "name" TEXT NOT NULL,
    "publicJwk" JSONB NOT NULL,
    "jwkThumbprint" TEXT NOT NULL,
    "status" "AgentHostStatus" NOT NULL DEFAULT 'PENDING',
    "defaultCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "AgentHost_pkey" PRIMARY KEY ("tenancyId", "id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "hostId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "AgentMode" NOT NULL,
    "projectUserId" UUID,
    "publicJwk" JSONB NOT NULL,
    "jwkThumbprint" TEXT NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxLifetimeEndsAt" TIMESTAMP(3) NOT NULL,
    "absoluteLifetimeEndsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("tenancyId", "id")
);

-- CreateTable
CREATE TABLE "AgentCapabilityGrant" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "agentId" UUID NOT NULL,
    "capability" TEXT NOT NULL,
    "status" "AgentCapabilityGrantStatus" NOT NULL DEFAULT 'PENDING',
    "constraints" JSONB,
    "grantedByProjectUserId" UUID,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "AgentCapabilityGrant_pkey" PRIMARY KEY ("tenancyId", "id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentHost_tenancyId_jwkThumbprint_key" ON "AgentHost"("tenancyId", "jwkThumbprint");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_tenancyId_jwkThumbprint_key" ON "Agent"("tenancyId", "jwkThumbprint");

-- CreateIndex
CREATE INDEX "Agent_tenancyId_hostId_idx" ON "Agent"("tenancyId", "hostId");

-- CreateIndex
CREATE INDEX "Agent_tenancyId_projectUserId_idx" ON "Agent"("tenancyId", "projectUserId");

-- CreateIndex
CREATE INDEX "AgentCapabilityGrant_tenancyId_agentId_idx" ON "AgentCapabilityGrant"("tenancyId", "agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCapabilityGrant_tenancyId_agentId_capability_key" ON "AgentCapabilityGrant"("tenancyId", "agentId", "capability");

-- AddForeignKey
ALTER TABLE "AgentHost" ADD CONSTRAINT "AgentHost_tenancyId_projectUserId_fkey" FOREIGN KEY ("tenancyId", "projectUserId") REFERENCES "ProjectUser"("tenancyId", "projectUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_tenancyId_hostId_fkey" FOREIGN KEY ("tenancyId", "hostId") REFERENCES "AgentHost"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_tenancyId_projectUserId_fkey" FOREIGN KEY ("tenancyId", "projectUserId") REFERENCES "ProjectUser"("tenancyId", "projectUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCapabilityGrant" ADD CONSTRAINT "AgentCapabilityGrant_tenancyId_agentId_fkey" FOREIGN KEY ("tenancyId", "agentId") REFERENCES "Agent"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCapabilityGrant" ADD CONSTRAINT "AgentCapabilityGrant_tenancyId_grantedByProjectUserId_fkey" FOREIGN KEY ("tenancyId", "grantedByProjectUserId") REFERENCES "ProjectUser"("tenancyId", "projectUserId") ON DELETE CASCADE ON UPDATE CASCADE;
