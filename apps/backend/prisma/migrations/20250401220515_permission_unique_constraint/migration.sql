/*
  Warnings:

  - A unique constraint covering the columns `[tenancyId,queryableId]` on the table `Permission` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Permission_tenancyId_queryableId_key" ON "Permission"("tenancyId", "queryableId");
