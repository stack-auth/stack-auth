-- CreateTable
CREATE TABLE "SubscriptionInvoice" (
    "id" UUID NOT NULL,
    "tenancyId" UUID NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "isSubscriptionCreationInvoice" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionInvoice_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoice_tenancyId_stripeInvoiceId_key" ON "SubscriptionInvoice"("tenancyId", "stripeInvoiceId");

-- AddForeignKey
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_tenancyId_stripeSubscriptionId_fkey" FOREIGN KEY ("tenancyId", "stripeSubscriptionId") REFERENCES "Subscription"("tenancyId", "stripeSubscriptionId") ON DELETE RESTRICT ON UPDATE CASCADE;

