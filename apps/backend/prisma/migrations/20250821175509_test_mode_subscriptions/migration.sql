/*
  Warnings:

  - Added the required column `creationSource` to the `Subscription` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "SubscriptionCreationSource" AS ENUM ('PURCHASE_PAGE', 'TEST_MODE');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "creationSource" "SubscriptionCreationSource",
ALTER COLUMN "stripeSubscriptionId" DROP NOT NULL;

-- Update existing subscriptions to have PURCHASE_PAGE as creationSource
UPDATE "Subscription" SET "creationSource" = 'PURCHASE_PAGE' WHERE "creationSource" IS NULL;

-- Make creationSource NOT NULL after setting default values
ALTER TABLE "Subscription" ALTER COLUMN "creationSource" SET NOT NULL;
