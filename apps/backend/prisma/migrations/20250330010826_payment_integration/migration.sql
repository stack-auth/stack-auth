-- CreateTable
CREATE TABLE "StripeConfig" (
    "id" UUID NOT NULL,
    "projectConfigId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "stripeAccountId" TEXT,
    "stripeSecretKey" TEXT,
    "stripePublishableKey" TEXT,
    "stripeWebhookSecret" TEXT,

    CONSTRAINT "StripeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "stripeProductId" TEXT,
    "associatedPermissionId" UUID,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StripeConfig_projectConfigId_key" ON "StripeConfig"("projectConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_projectId_key" ON "Product"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_stripeProductId_key" ON "Product"("stripeProductId");

-- AddForeignKey
ALTER TABLE "StripeConfig" ADD CONSTRAINT "StripeConfig_projectConfigId_fkey" FOREIGN KEY ("projectConfigId") REFERENCES "ProjectConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_associatedPermissionId_fkey" FOREIGN KEY ("associatedPermissionId") REFERENCES "Permission"("dbId") ON DELETE SET NULL ON UPDATE CASCADE;
