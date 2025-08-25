/*
  Warnings:

  - Added the required column `customerType` to the `ItemQuantityChange` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "CustomerType" ADD VALUE 'CUSTOM';

-- AlterTable
ALTER TABLE "ItemQuantityChange" ALTER COLUMN "customerId" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "Subscription" ALTER COLUMN "customerId" SET DATA TYPE TEXT;
