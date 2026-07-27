-- CreateEnum
CREATE TYPE "WorkflowRunState" AS ENUM ('QUEUED', 'RUNNING', 'SLEEPING', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "WorkflowRunFailureKind" AS ENUM ('USER', 'PLATFORM');

-- CreateEnum
CREATE TYPE "WorkflowStepKind" AS ENUM ('RUN', 'SLEEP');

-- CreateEnum
CREATE TYPE "WorkflowStepAttemptOutcome" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "WorkflowDefinition" (
    "tenancyId" UUID NOT NULL,
    "workflowId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "latestVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowDefinition_pkey" PRIMARY KEY ("tenancyId","workflowId")
);

-- CreateTable
CREATE TABLE "WorkflowVersion" (
    "tenancyId" UUID NOT NULL,
    "workflowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "compiledBundle" TEXT NOT NULL,
    "runtimeEnvVersion" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowVersion_pkey" PRIMARY KEY ("tenancyId","workflowId","version")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "workflowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "runKey" TEXT,
    "state" "WorkflowRunState" NOT NULL DEFAULT 'QUEUED',
    "isActive" BOOLEAN GENERATED ALWAYS AS (CASE WHEN "state" IN ('QUEUED', 'RUNNING', 'SLEEPING') THEN TRUE ELSE NULL END) STORED,
    "triggerEventId" UUID,
    "triggerType" TEXT NOT NULL,
    "triggerPayload" JSONB NOT NULL,
    "currentStepKey" TEXT,
    "wakeAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" UUID,
    "currentStepAttempt" INTEGER NOT NULL DEFAULT 0,
    "retryEpoch" INTEGER NOT NULL DEFAULT 0,
    "memoTotalBytes" INTEGER NOT NULL DEFAULT 0,
    "failureKind" "WorkflowRunFailureKind",
    "errorSummary" TEXT,
    "lastUpgradeDivergence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateTable
CREATE TABLE "WorkflowStepResult" (
    "tenancyId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "stepKey" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "kind" "WorkflowStepKind" NOT NULL,
    "result" JSONB,
    "resultSizeBytes" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL,
    "executedAtVersion" INTEGER NOT NULL,
    "elapsedMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowStepResult_pkey" PRIMARY KEY ("tenancyId","runId","stepKey")
);

-- CreateTable
CREATE TABLE "WorkflowStepAttempt" (
    "tenancyId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "stepKey" TEXT NOT NULL,
    "retryEpoch" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL,
    "stepId" TEXT NOT NULL,
    "outcome" "WorkflowStepAttemptOutcome" NOT NULL,
    "error" JSONB,
    "failureKind" "WorkflowRunFailureKind",
    "logs" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowStepAttempt_pkey" PRIMARY KEY ("tenancyId","runId","stepKey","retryEpoch","attempt")
);

-- CreateTable
CREATE TABLE "WorkflowEvent" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowEvent_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateTable
CREATE TABLE "WorkflowScheduleCursor" (
    "tenancyId" UUID NOT NULL,
    "workflowId" TEXT NOT NULL,
    "scheduleKey" TEXT NOT NULL,
    "lastMaterializedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowScheduleCursor_pkey" PRIMARY KEY ("tenancyId","workflowId","scheduleKey")
);

-- CreateIndex
CREATE INDEX "WorkflowRun_list_idx" ON "WorkflowRun"("tenancyId", "workflowId", "state", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WorkflowRun_due_idx" ON "WorkflowRun"("state", "wakeAt");

-- CreateIndex
CREATE INDEX "WorkflowRun_lease_idx" ON "WorkflowRun"("state", "leaseUntil");

-- CreateIndex
CREATE INDEX "WorkflowRun_version_idx" ON "WorkflowRun"("tenancyId", "workflowId", "version", "state");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRun_active_run_key" ON "WorkflowRun"("tenancyId", "workflowId", "runKey", "isActive");

-- CreateIndex
CREATE INDEX "WorkflowEvent_outbox_idx" ON "WorkflowEvent"("processedAt", "scheduledAt");

-- CreateIndex
CREATE INDEX "WorkflowEvent_tenancy_created_idx" ON "WorkflowEvent"("tenancyId", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkflowStepResult" ADD CONSTRAINT "WorkflowStepResult_tenancyId_runId_fkey" FOREIGN KEY ("tenancyId", "runId") REFERENCES "WorkflowRun"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStepAttempt" ADD CONSTRAINT "WorkflowStepAttempt_tenancyId_runId_fkey" FOREIGN KEY ("tenancyId", "runId") REFERENCES "WorkflowRun"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

