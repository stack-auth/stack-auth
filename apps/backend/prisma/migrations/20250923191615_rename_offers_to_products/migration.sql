-- AlterTable
ALTER TABLE "OneTimePurchase" 
RENAME COLUMN "offer" TO "product";

-- AlterTable
ALTER TABLE "OneTimePurchase" 
RENAME COLUMN "offerId" TO "productId";

-- AlterTable
ALTER TABLE "Subscription" 
RENAME COLUMN "offer" TO "product";

-- AlterTable
ALTER TABLE "Subscription" 
RENAME COLUMN "offerId" TO "productId";
