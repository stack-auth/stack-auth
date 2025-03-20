-- CreateTable
CREATE TABLE "StripeConfig" (
    "id" UUID NOT NULL,
    "projectConfigId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "stripeSecretKey" TEXT NOT NULL,
    "stripePublishableKey" TEXT NOT NULL,
    "stripeWebhookSecret" TEXT,

    CONSTRAINT "StripeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StripeConfig_projectConfigId_key" ON "StripeConfig"("projectConfigId");

-- AddForeignKey
ALTER TABLE "StripeConfig" ADD CONSTRAINT "StripeConfig_projectConfigId_fkey" FOREIGN KEY ("projectConfigId") REFERENCES "ProjectConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
