-- CreateEnum
CREATE TYPE "BrainRunState" AS ENUM ('IDLE', 'RUNNING');

-- CreateEnum
CREATE TYPE "BrainQueueItemStatus" AS ENUM ('QUEUED', 'CLAIMED', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Brain" (
    "tenancyId" UUID NOT NULL,
    "nextMessagePosition" INTEGER NOT NULL DEFAULT 0,
    "summaryText" TEXT,
    "summaryThroughPosition" INTEGER,
    "runState" "BrainRunState" NOT NULL DEFAULT 'IDLE',
    "runLeaseUntil" TIMESTAMP(3),
    "runLeaseToken" UUID,
    "runWakeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brain_pkey" PRIMARY KEY ("tenancyId")
);

-- CreateTable
CREATE TABLE "BrainMessage" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "position" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'visible',
    "queueItemId" UUID,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrainMessage_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateTable
CREATE TABLE "BrainQueueItem" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "idempotencyKey" TEXT,
    "status" "BrainQueueItemStatus" NOT NULL DEFAULT 'QUEUED',
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "claimedAt" TIMESTAMP(3),
    "claimLeaseUntil" TIMESTAMP(3),
    "claimLeaseToken" UUID,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrainQueueItem_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateIndex
CREATE INDEX "Brain_wake_idx" ON "Brain"("runState", "runWakeAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrainMessage_tenancyId_position_key" ON "BrainMessage"("tenancyId", "position");

-- CreateIndex
CREATE INDEX "BrainMessage_tenancy_created_idx" ON "BrainMessage"("tenancyId", "createdAt");

-- Partial unique: deterministic appends are idempotent; NULLs may collide.
CREATE UNIQUE INDEX "BrainMessage_tenancyId_idempotencyKey_key"
  ON "BrainMessage"("tenancyId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

-- CreateIndex
CREATE INDEX "BrainQueueItem_pending_idx" ON "BrainQueueItem"("tenancyId", "status", "availableAt", "createdAt");

-- CreateIndex
CREATE INDEX "BrainQueueItem_tenancy_created_idx" ON "BrainQueueItem"("tenancyId", "createdAt");

-- Partial unique: provider redelivery / deterministic enqueue dedup.
CREATE UNIQUE INDEX "BrainQueueItem_tenancyId_idempotencyKey_key"
  ON "BrainQueueItem"("tenancyId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "Brain" ADD CONSTRAINT "Brain_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainMessage" ADD CONSTRAINT "BrainMessage_brain_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Brain"("tenancyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainQueueItem" ADD CONSTRAINT "BrainQueueItem_brain_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Brain"("tenancyId") ON DELETE CASCADE ON UPDATE CASCADE;
