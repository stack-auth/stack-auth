-- Both tables created here are brand-new (guaranteed empty), so plain CREATE
-- TABLE / CREATE INDEX statements are safe regardless of overall database size
-- — no batching or concurrent index builds needed.

-- CreateEnum
CREATE TYPE "ExperimentRunState" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED');

-- CreateTable
CREATE TABLE "ExperimentRun" (
    "id" UUID NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,
    "configRevisionHash" TEXT NOT NULL,
    "configSnapshot" JSONB NOT NULL,
    "state" "ExperimentRunState" NOT NULL DEFAULT 'DRAFT',
    "scheduledStartAt" TIMESTAMP(3),
    "scheduledEndAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExperimentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlagAuditLog" (
    "id" UUID NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "source" TEXT NOT NULL,
    "beforeState" JSONB,
    "afterState" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureFlagAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExperimentRun_project_experiment_createdAt_idx" ON "ExperimentRun"("projectId", "branchId", "experimentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ExperimentRun_state_scheduledStartAt_idx" ON "ExperimentRun"("state", "scheduledStartAt");

-- CreateIndex
CREATE INDEX "ExperimentRun_state_scheduledEndAt_idx" ON "ExperimentRun"("state", "scheduledEndAt");

-- Partial unique index: at most one RUNNING or PAUSED run may exist per
-- project+branch+experiment at any time. This is the database-level backstop
-- for the application-level state machine (concurrent "start" calls can't both
-- succeed), and is not expressible in the Prisma schema.
CREATE UNIQUE INDEX "ExperimentRun_active_run_key" ON "ExperimentRun"("projectId", "branchId", "experimentId") WHERE "state" IN ('RUNNING', 'PAUSED');

-- CreateIndex
CREATE INDEX "FeatureFlagAuditLog_resource_createdAt_idx" ON "FeatureFlagAuditLog"("projectId", "branchId", "resourceType", "resourceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "FeatureFlagAuditLog_project_createdAt_idx" ON "FeatureFlagAuditLog"("projectId", "branchId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "ExperimentRun" ADD CONSTRAINT "ExperimentRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureFlagAuditLog" ADD CONSTRAINT "FeatureFlagAuditLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
