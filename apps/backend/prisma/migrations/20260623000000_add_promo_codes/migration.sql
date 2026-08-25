-- CreateEnum
CREATE TYPE "PromoCodeDiscountType" AS ENUM ('PERCENT', 'AMOUNT_OFF_USD');

-- CreateEnum
CREATE TYPE "PromoCodeSubscriptionDuration" AS ENUM ('FIRST_INVOICE', 'FOREVER');

-- CreateEnum
CREATE TYPE "PromoCodeRedemptionStatus" AS ENUM ('RESERVED', 'APPLIED', 'VOIDED');

-- CreateTable
CREATE TABLE "PromoCode" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenancyId" UUID NOT NULL,
    "displayName" TEXT,
    "codeHash" TEXT NOT NULL,
    "codePrefix" TEXT,
    "codeLast4" TEXT,
    "discountType" "PromoCodeDiscountType" NOT NULL,
    "percentOffBps" INTEGER,
    "amountOffUsdCents" INTEGER,
    "subscriptionDuration" "PromoCodeSubscriptionDuration" NOT NULL,
    "customerType" "CustomerType",
    "customerId" TEXT,
    "productLineId" TEXT,
    "productId" TEXT,
    "priceId" TEXT,
    "maxRedemptions" INTEGER,
    "maxRedemptionsPerCustomer" INTEGER,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("tenancyId","id"),
    CONSTRAINT "PromoCode_discount_fields_check" CHECK (
        (
            "discountType" = 'PERCENT'::"PromoCodeDiscountType"
            AND "percentOffBps" IS NOT NULL
            AND "percentOffBps" BETWEEN 1 AND 10000
            AND "amountOffUsdCents" IS NULL
        )
        OR (
            "discountType" = 'AMOUNT_OFF_USD'::"PromoCodeDiscountType"
            AND "amountOffUsdCents" IS NOT NULL
            AND "amountOffUsdCents" >= 1
            AND "percentOffBps" IS NULL
        )
    ),
    CONSTRAINT "PromoCode_max_redemptions_check" CHECK (
        ("maxRedemptions" IS NULL OR "maxRedemptions" >= 1)
        AND ("maxRedemptionsPerCustomer" IS NULL OR "maxRedemptionsPerCustomer" >= 1)
    ),
    CONSTRAINT "PromoCode_time_window_check" CHECK (
        "startsAt" IS NULL OR "expiresAt" IS NULL OR "expiresAt" > "startsAt"
    )
);

-- CreateTable
CREATE TABLE "PromoCodeRedemption" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenancyId" UUID NOT NULL,
    "promoCodeId" UUID NOT NULL,
    "customerType" "CustomerType" NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT,
    "priceId" TEXT,
    "productVersionId" TEXT,
    "quantity" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "originalAmountUsdCents" INTEGER NOT NULL,
    "discountAmountUsdCents" INTEGER NOT NULL,
    "finalAmountUsdCents" INTEGER NOT NULL,
    "subscriptionDuration" "PromoCodeSubscriptionDuration",
    "status" "PromoCodeRedemptionStatus" NOT NULL,
    "reservationExpiresAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "stripePaymentIntentId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripeInvoiceId" TEXT,
    "subscriptionId" UUID,
    "oneTimePurchaseId" UUID,
    "subscriptionInvoiceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoCodeRedemption_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_tenancyId_codeHash_key" ON "PromoCode"("tenancyId", "codeHash");

-- CreateIndex
CREATE INDEX "PromoCode_tenancy_deleted_disabled_idx" ON "PromoCode"("tenancyId", "deletedAt", "disabledAt");

-- CreateIndex
CREATE INDEX "PromoCode_tenancy_product_idx" ON "PromoCode"("tenancyId", "productId");

-- CreateIndex
CREATE INDEX "PromoCode_tenancy_customer_idx" ON "PromoCode"("tenancyId", "customerType", "customerId");

-- CreateIndex
CREATE INDEX "PromoCode_tenancy_expires_idx" ON "PromoCode"("tenancyId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCodeRedemption_tenancyId_stripePaymentIntentId_key" ON "PromoCodeRedemption"("tenancyId", "stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCodeRedemption_tenancyId_stripeSubscriptionId_promoCodeId_key" ON "PromoCodeRedemption"("tenancyId", "stripeSubscriptionId", "promoCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCodeRedemption_applied_one_time_purchase_key" ON "PromoCodeRedemption"("tenancyId", "oneTimePurchaseId") WHERE "status" = 'APPLIED'::"PromoCodeRedemptionStatus" AND "oneTimePurchaseId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "PromoCodeRedemption_applied_subscription_promo_key" ON "PromoCodeRedemption"("tenancyId", "subscriptionId", "promoCodeId") WHERE "status" = 'APPLIED'::"PromoCodeRedemptionStatus" AND "subscriptionId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "PromoCodeRedemption_applied_subscription_invoice_promo_key" ON "PromoCodeRedemption"("tenancyId", "subscriptionInvoiceId", "promoCodeId") WHERE "status" = 'APPLIED'::"PromoCodeRedemptionStatus" AND "subscriptionInvoiceId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "PromoCodeRedemption_tenancy_promo_created_idx" ON "PromoCodeRedemption"("tenancyId", "promoCodeId", "createdAt");

-- CreateIndex
CREATE INDEX "PromoCodeRedemption_tenancy_customer_promo_idx" ON "PromoCodeRedemption"("tenancyId", "customerType", "customerId", "promoCodeId");

-- CreateIndex
CREATE INDEX "PromoCodeRedemption_tenancy_status_reservation_idx" ON "PromoCodeRedemption"("tenancyId", "status", "reservationExpiresAt");

-- AddForeignKey
ALTER TABLE "PromoCodeRedemption" ADD CONSTRAINT "PromoCodeRedemption_promoCode_fkey" FOREIGN KEY ("tenancyId", "promoCodeId") REFERENCES "PromoCode"("tenancyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCodeRedemption" ADD CONSTRAINT "PromoCodeRedemption_subscription_fkey" FOREIGN KEY ("tenancyId", "subscriptionId") REFERENCES "Subscription"("tenancyId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCodeRedemption" ADD CONSTRAINT "PromoCodeRedemption_oneTimePurchase_fkey" FOREIGN KEY ("tenancyId", "oneTimePurchaseId") REFERENCES "OneTimePurchase"("tenancyId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCodeRedemption" ADD CONSTRAINT "PromoCodeRedemption_subscriptionInvoice_fkey" FOREIGN KEY ("tenancyId", "subscriptionInvoiceId") REFERENCES "SubscriptionInvoice"("tenancyId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCodeRedemption" ADD CONSTRAINT "PromoCodeRedemption_productVersion_fkey" FOREIGN KEY ("tenancyId", "productVersionId") REFERENCES "ProductVersion"("tenancyId", "productVersionId") ON DELETE NO ACTION ON UPDATE CASCADE;
