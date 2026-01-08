-- CreateEnum
CREATE TYPE "SubscriptionChangeType" AS ENUM ('PRICE_CHANGE', 'QUANTITY_CHANGE', 'PERIOD_CHANGE', 'STATUS_CHANGE', 'METADATA_CHANGE', 'OTHER');

-- CreateTable
CREATE TABLE "StripeRefund" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenancyId" UUID NOT NULL,
    "stripeRefundId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "subscriptionId" UUID,
    "oneTimePurchaseId" UUID,
    "customerId" TEXT NOT NULL,
    "customerType" "CustomerType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeRefund_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateTable
CREATE TABLE "ProductChange" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenancyId" UUID NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerType" "CustomerType" NOT NULL,
    "subscriptionId" UUID,
    "oldProductId" TEXT,
    "oldPriceId" TEXT,
    "oldProduct" JSONB,
    "newProductId" TEXT,
    "newPriceId" TEXT,
    "newProduct" JSONB,
    "oldQuantity" INTEGER NOT NULL DEFAULT 1,
    "newQuantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductChange_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateTable
CREATE TABLE "SubscriptionChange" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenancyId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerType" "CustomerType" NOT NULL,
    "changeType" "SubscriptionChangeType" NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionChange_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StripeRefund_tenancyId_stripeRefundId_key" ON "StripeRefund"("tenancyId", "stripeRefundId");

-- CreateIndex
CREATE INDEX "StripeRefund_tenancyId_subscriptionId_idx" ON "StripeRefund"("tenancyId", "subscriptionId");

-- CreateIndex
CREATE INDEX "StripeRefund_tenancyId_oneTimePurchaseId_idx" ON "StripeRefund"("tenancyId", "oneTimePurchaseId");

-- CreateIndex
CREATE INDEX "ProductChange_tenancyId_subscriptionId_idx" ON "ProductChange"("tenancyId", "subscriptionId");

-- CreateIndex
CREATE INDEX "ProductChange_tenancyId_customerId_idx" ON "ProductChange"("tenancyId", "customerId");

-- CreateIndex
CREATE INDEX "SubscriptionChange_tenancyId_subscriptionId_idx" ON "SubscriptionChange"("tenancyId", "subscriptionId");

-- CreateIndex
CREATE INDEX "SubscriptionChange_tenancyId_customerId_idx" ON "SubscriptionChange"("tenancyId", "customerId");

