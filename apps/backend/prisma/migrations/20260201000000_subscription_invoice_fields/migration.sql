ALTER TABLE "SubscriptionInvoice"
  ADD COLUMN "status" TEXT,
  ADD COLUMN "amountTotal" INTEGER,
  ADD COLUMN "hostedInvoiceUrl" TEXT;
