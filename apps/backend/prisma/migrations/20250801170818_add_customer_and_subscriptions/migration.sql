-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('USER', 'TEAM');

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "tenancyId" UUID NOT NULL,
    "customerType" "CustomerType" NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "tenancyId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenancyId_stripeCustomerId_key" ON "Customer"("tenancyId", "stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_tenancyId_stripeSubscriptionId_key" ON "Subscription"("tenancyId", "stripeSubscriptionId");
