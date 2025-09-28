-- CreateTable
CREATE TABLE "DataVaultEntry" (
    "id" UUID NOT NULL,
    "tenancyId" UUID NOT NULL,
    "storeId" TEXT NOT NULL,
    "hashedKey" TEXT NOT NULL,
    "encrypted" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataVaultEntry_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateIndex
CREATE INDEX "DataVaultEntry_tenancyId_storeId_idx" ON "DataVaultEntry"("tenancyId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "DataVaultEntry_tenancyId_storeId_hashedKey_key" ON "DataVaultEntry"("tenancyId", "storeId", "hashedKey");
