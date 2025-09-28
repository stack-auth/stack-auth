-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('USER', 'TEAM');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'trialing', 'canceled', 'paused', 'incomplete', 'incomplete_expired', 'past_due', 'unpaid');

-- AlterEnum
ALTER TYPE "VerificationCodeType" ADD VALUE 'PURCHASE_URL';

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "tenancyId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "customerType" "CustomerType" NOT NULL,
    "offer" JSONB NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_tenancyId_stripeSubscriptionId_key" ON "Subscription"("tenancyId", "stripeSubscriptionId");
