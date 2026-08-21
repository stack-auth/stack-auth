-- This nullable column is metadata-only on PostgreSQL: adding it without a
-- default does not rewrite SubscriptionInvoice or touch existing rows, keeping
-- the change safe for a table that may contain millions of invoices. NULL means
-- no authoritative outcome event has been applied to the invoice yet.
ALTER TABLE "SubscriptionInvoice"
  ADD COLUMN "paymentOutcomeEventAt" TIMESTAMP(3);
