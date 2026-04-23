-- CreateTable
CREATE TABLE "PlatformFeeEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenancyId" UUID NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL CHECK ("sourceType" IN ('REFUND')),
    "sourceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL CHECK ("amount" >= 0),
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL CHECK ("status" IN ('PENDING', 'COLLECTED', 'FAILED')),
    "stripeTransferId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "collectedAt" TIMESTAMP(3),

    CONSTRAINT "PlatformFeeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformFeeEvent_sourceType_sourceId_key" ON "PlatformFeeEvent"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "PlatformFeeEvent_tenancyId_idx" ON "PlatformFeeEvent"("tenancyId");

-- CreateIndex
CREATE INDEX "PlatformFeeEvent_projectId_idx" ON "PlatformFeeEvent"("projectId");

-- CreateIndex
CREATE INDEX "PlatformFeeEvent_status_idx" ON "PlatformFeeEvent"("status");
