-- CreateTable
CREATE TABLE "StripeConfig" (
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "stripeSecretKey" TEXT NOT NULL,
    "stripePublishableKey" TEXT NOT NULL,
    "stripeWebhookSecret" TEXT,

    CONSTRAINT "StripeConfig_pkey" PRIMARY KEY ("projectId")
);

-- AddForeignKey
ALTER TABLE "StripeConfig" ADD CONSTRAINT "StripeConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
