-- CreateEnum
ALTER TYPE "SubscriptionCreationSource" RENAME TO "PurchaseCreationSource";

-- CreateTable
CREATE TABLE "OneTimePurchase" (
    "id" UUID NOT NULL,
    "tenancyId" UUID NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerType" "CustomerType" NOT NULL,
    "offerId" TEXT,
    "offer" JSONB NOT NULL,
    "quantity" INTEGER NOT NULL,
    "stripePaymentIntentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creationSource" "PurchaseCreationSource" NOT NULL,

    CONSTRAINT "OneTimePurchase_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OneTimePurchase_tenancyId_stripePaymentIntentId_key" ON "OneTimePurchase"("tenancyId", "stripePaymentIntentId");
