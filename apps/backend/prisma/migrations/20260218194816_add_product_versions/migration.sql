-- CreateTable
CREATE TABLE "ProductVersion" (
    "tenancyId" UUID NOT NULL,
    "productVersionId" TEXT NOT NULL,
    "productId" TEXT,
    "productJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductVersion_pkey" PRIMARY KEY ("tenancyId","productVersionId")
);

