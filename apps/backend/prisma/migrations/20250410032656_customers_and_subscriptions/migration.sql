-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('INACTIVE', 'ACTIVE', 'CANCELLED', 'TRIAL', 'PAUSED');

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
    "tenancyId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("tenancyId","customerId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_stripeCustomerId_key" ON "Customer"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_teamId_key" ON "Customer"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenancyId_projectUserId_key" ON "Customer"("tenancyId", "projectUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenancyId_teamId_key" ON "Customer"("tenancyId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenancyId_projectUserId_fkey" FOREIGN KEY ("tenancyId", "projectUserId") REFERENCES "ProjectUser"("tenancyId", "projectUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenancyId_teamId_fkey" FOREIGN KEY ("tenancyId", "teamId") REFERENCES "Team"("tenancyId", "teamId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenancyId_customerId_fkey" FOREIGN KEY ("tenancyId", "customerId") REFERENCES "Customer"("tenancyId", "customerId") ON DELETE CASCADE ON UPDATE CASCADE;
