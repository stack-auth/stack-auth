-- CreateTable
CREATE TABLE "EmailTheme" (
    "id" UUID NOT NULL,
    "tenancyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTheme_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailTheme_tenancyId_name_key" ON "EmailTheme"("tenancyId", "name");

-- AddForeignKey
ALTER TABLE "EmailTheme" ADD CONSTRAINT "EmailTheme_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
