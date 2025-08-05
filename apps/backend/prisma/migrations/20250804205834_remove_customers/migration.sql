/*
  Warnings:

  - You are about to drop the `Customer` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `customerType` to the `Subscription` table without a default value. This is not possible if the table is not empty.
  - Added the required column `offer` to the `Subscription` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `status` on the `Subscription` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'trialing', 'canceled', 'paused', 'incomplete', 'incomplete_expired', 'past_due', 'unpaid');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "customerType" "CustomerType" NOT NULL,
ADD COLUMN     "offer" JSONB NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "SubscriptionStatus" NOT NULL;

-- DropTable
DROP TABLE "Customer";
