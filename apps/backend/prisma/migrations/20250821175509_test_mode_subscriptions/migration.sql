/*
  Warnings:

  - Added the required column `creationSource` to the `Subscription` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "SubscriptionCreationSource" AS ENUM ('PURCHASE_PAGE', 'TEST_MODE');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "creationSource" "SubscriptionCreationSource" NOT NULL,
ALTER COLUMN "stripeSubscriptionId" DROP NOT NULL;
