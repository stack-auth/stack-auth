/*
  Warnings:

  - A unique constraint covering the columns `[stripeAccountId]` on the table `StripeConfig` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "StripeConfig_stripeAccountId_key" ON "StripeConfig"("stripeAccountId");
