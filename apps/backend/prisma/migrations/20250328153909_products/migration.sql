-- AlterTable
ALTER TABLE "Permission" ADD COLUMN     "productId" UUID;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
