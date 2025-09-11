/*
  Warnings:

  - Changed the type of `creationSource` on the `Subscription` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "PurchaseCreationSource" AS ENUM ('PURCHASE_PAGE', 'TEST_MODE');

-- AlterTable
ALTER TABLE "Subscription" DROP COLUMN "creationSource",
ADD COLUMN     "creationSource" "PurchaseCreationSource" NOT NULL;

-- DropEnum
DROP TYPE "SubscriptionCreationSource";

-- CreateTable
CREATE TABLE "OneTimePurchase" (
    "id" UUID NOT NULL,
    "tenancyId" UUID NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerType" "CustomerType" NOT NULL,
    "offerId" TEXT,
    "offer" JSONB NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creationSource" "PurchaseCreationSource" NOT NULL,

    CONSTRAINT "OneTimePurchase_pkey" PRIMARY KEY ("tenancyId","id")
);
