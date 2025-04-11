-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE_GLOBAL', 'STRIPE_CONNECT', 'STRIPE_DIRECT');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('INACTIVE', 'ACTIVE', 'CANCELLED', 'TRIAL', 'PAUSED');

-- CreateTable
CREATE TABLE "PaymentConfig" (
    "id" UUID NOT NULL,
    "projectConfigId" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "stripeAccountId" TEXT,

    CONSTRAINT "PaymentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "paymentConfigId" UUID NOT NULL,
    "stripeProductId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Price" (
    "id" UUID NOT NULL,
    "name" TEXT,
    "productId" UUID NOT NULL,
    "stripePriceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "tenancyId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "stripeCustomerId" TEXT,
    "projectUserId" UUID,
    "teamId" UUID,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("tenancyId","customerId")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "tenancyId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "stripeSubscriptionId" TEXT,
    "stripeSubscriptionItemId" TEXT,
    "status" "SubscriptionStatus" NOT NULL,
    "priceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentConfig_projectConfigId_key" ON "PaymentConfig"("projectConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentConfig_stripeAccountId_key" ON "PaymentConfig"("stripeAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_stripeProductId_key" ON "Product"("stripeProductId");

-- CreateIndex
CREATE INDEX "Product_paymentConfigId_idx" ON "Product"("paymentConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "Price_stripePriceId_key" ON "Price"("stripePriceId");

-- CreateIndex
CREATE INDEX "Price_productId_idx" ON "Price"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_stripeCustomerId_key" ON "Customer"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_teamId_key" ON "Customer"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenancyId_projectUserId_key" ON "Customer"("tenancyId", "projectUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenancyId_teamId_key" ON "Customer"("tenancyId", "teamId");

-- CreateIndex
CREATE INDEX "Subscription_tenancyId_customerId_idx" ON "Subscription"("tenancyId", "customerId");

-- CreateIndex
CREATE INDEX "Subscription_priceId_idx" ON "Subscription"("priceId");

-- AddForeignKey
ALTER TABLE "PaymentConfig" ADD CONSTRAINT "PaymentConfig_projectConfigId_fkey" FOREIGN KEY ("projectConfigId") REFERENCES "ProjectConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_paymentConfigId_fkey" FOREIGN KEY ("paymentConfigId") REFERENCES "PaymentConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Price" ADD CONSTRAINT "Price_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenancyId_projectUserId_fkey" FOREIGN KEY ("tenancyId", "projectUserId") REFERENCES "ProjectUser"("tenancyId", "projectUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenancyId_teamId_fkey" FOREIGN KEY ("tenancyId", "teamId") REFERENCES "Team"("tenancyId", "teamId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenancyId_customerId_fkey" FOREIGN KEY ("tenancyId", "customerId") REFERENCES "Customer"("tenancyId", "customerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_priceId_fkey" FOREIGN KEY ("priceId") REFERENCES "Price"("id") ON DELETE CASCADE ON UPDATE CASCADE;
