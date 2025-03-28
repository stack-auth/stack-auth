/*
  Warnings:

  - You are about to drop the column `productId` on the `Permission` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Permission" DROP CONSTRAINT "Permission_productId_fkey";

-- AlterTable
ALTER TABLE "Permission" DROP COLUMN "productId";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "associatedPermissionId" UUID;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_associatedPermissionId_fkey" FOREIGN KEY ("associatedPermissionId") REFERENCES "Permission"("dbId") ON DELETE SET NULL ON UPDATE CASCADE;
