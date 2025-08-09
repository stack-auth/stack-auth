-- CreateTable
CREATE TABLE "ItemQuantityChange" (
    "id" UUID NOT NULL,
    "tenancyId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "description" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemQuantityChange_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateIndex
CREATE INDEX "ItemQuantityChange_tenancyId_customerId_expiresAt_idx" ON "ItemQuantityChange"("tenancyId", "customerId", "expiresAt");
