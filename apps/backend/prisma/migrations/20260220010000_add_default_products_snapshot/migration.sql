-- CreateTable
CREATE TABLE "DefaultProductsSnapshot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenancyId" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DefaultProductsSnapshot_pkey" PRIMARY KEY ("tenancyId","id")
);
