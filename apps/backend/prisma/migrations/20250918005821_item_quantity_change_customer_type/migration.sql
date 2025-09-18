/*
  Warnings:

  - Added the required column `customerType` to the `ItemQuantityChange` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ItemQuantityChange" ADD COLUMN     "customerType" "CustomerType" NOT NULL;
