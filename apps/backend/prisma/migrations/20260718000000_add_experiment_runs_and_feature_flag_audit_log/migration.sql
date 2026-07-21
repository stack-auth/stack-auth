-- All tables created here are brand-new (guaranteed empty), so plain CREATE
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

-- Small Postgres idempotency ledger; telemetry payloads remain in ClickHouse.
CREATE TABLE "FeatureFlagExposureReceipt" (
    "id" UUID NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "eventId" UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "batchPayloadHash" TEXT NOT NULL,
    "ingestionNonce" UUID NOT NULL,
    "processingStartedAt" TIMESTAMP(3),
    "billingNonce" UUID,
    "billingStartedAt" TIMESTAMP(3),
    "billingCompletedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureFlagExposureReceipt_pkey" PRIMARY KEY ("id")
);

-- Bounded Postgres idempotency ledger for analytics batch retries. High-volume
-- event payloads continue to live only in ClickHouse.
CREATE TABLE "AnalyticsEventBatchReceipt" (
    "id" UUID NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "batchId" UUID NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "eventCount" INTEGER NOT NULL,
    "insertedCount" INTEGER,
    "processingNonce" UUID,
    "processingStartedAt" TIMESTAMP(3),
    "billingNonce" UUID,
    "billingStartedAt" TIMESTAMP(3),
    "billingCompletedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEventBatchReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExperimentRun_project_experiment_createdAt_idx" ON "ExperimentRun"("projectId", "branchId", "experimentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ExperimentRun_state_scheduledStartAt_idx" ON "ExperimentRun"("state", "scheduledStartAt");

-- CreateIndex
CREATE INDEX "ExperimentRun_state_scheduledEndAt_idx" ON "ExperimentRun"("state", "scheduledEndAt");

-- Scheduler fairness rotates blocked rows by updatedAt, then preserves stable
-- schedule/id ordering inside the bounded page.
CREATE INDEX "ExperimentRun_schedule_start_rotation_idx" ON "ExperimentRun"("state", "updatedAt", "scheduledStartAt", "id");
CREATE INDEX "ExperimentRun_schedule_end_rotation_idx" ON "ExperimentRun"("state", "updatedAt", "scheduledEndAt", "id");

-- Partial unique index: at most one RUNNING or PAUSED run may exist per
-- project+branch+experiment at any time. This is the database-level backstop
-- for the application-level state machine (concurrent "start" calls can't both
-- succeed), and is not expressible in the Prisma schema.
CREATE UNIQUE INDEX "ExperimentRun_active_run_key" ON "ExperimentRun"("projectId", "branchId", "experimentId") WHERE "state" IN ('RUNNING', 'PAUSED');

-- Different experiment definitions may reference the same feature flag. They
-- must not both become active: the evaluator can serve only one immutable
-- allocation for a flag at a time. Snapshots always store the internal flag id,
-- so the JSONB expression is stable across public-key renames.
CREATE UNIQUE INDEX "ExperimentRun_active_flag_key" ON "ExperimentRun"("projectId", "branchId", ("configSnapshot"->>'flag_id')) WHERE "state" IN ('RUNNING', 'PAUSED');

-- CreateIndex
CREATE INDEX "FeatureFlagAuditLog_resource_createdAt_idx" ON "FeatureFlagAuditLog"("projectId", "branchId", "resourceType", "resourceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "FeatureFlagAuditLog_project_createdAt_idx" ON "FeatureFlagAuditLog"("projectId", "branchId", "createdAt" DESC);

CREATE UNIQUE INDEX "FeatureFlagExposureReceipt_project_event_key" ON "FeatureFlagExposureReceipt"("projectId", "eventId");
CREATE UNIQUE INDEX "FeatureFlagExposureReceipt_project_evaluation_key" ON "FeatureFlagExposureReceipt"("projectId", "evaluationId");
CREATE INDEX "FeatureFlagExposureReceipt_ingestionNonce_idx" ON "FeatureFlagExposureReceipt"("ingestionNonce");
CREATE INDEX "FeatureFlagExposureReceipt_processingStartedAt_idx" ON "FeatureFlagExposureReceipt"("processingStartedAt");
CREATE INDEX "FeatureFlagExposureReceipt_project_createdAt_idx" ON "FeatureFlagExposureReceipt"("projectId", "branchId", "createdAt" DESC);

CREATE UNIQUE INDEX "AnalyticsEventBatchReceipt_project_branch_batch_key" ON "AnalyticsEventBatchReceipt"("projectId", "branchId", "batchId");
CREATE INDEX "AnalyticsEventBatchReceipt_processingStartedAt_idx" ON "AnalyticsEventBatchReceipt"("processingStartedAt");
CREATE INDEX "AnalyticsEventBatchReceipt_createdAt_idx" ON "AnalyticsEventBatchReceipt"("createdAt");

-- AddForeignKey
ALTER TABLE "ExperimentRun" ADD CONSTRAINT "ExperimentRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureFlagAuditLog" ADD CONSTRAINT "FeatureFlagAuditLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FeatureFlagExposureReceipt" ADD CONSTRAINT "FeatureFlagExposureReceipt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnalyticsEventBatchReceipt" ADD CONSTRAINT "AnalyticsEventBatchReceipt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
