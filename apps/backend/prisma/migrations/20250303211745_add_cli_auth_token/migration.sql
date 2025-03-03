-- CreateTable
CREATE TABLE "CliAuthToken" (
    "id" UUID NOT NULL,
    "pollingToken" TEXT NOT NULL,
    "internalToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "tenancyId" UUID,
    "projectUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CliAuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CliAuthToken_pollingToken_key" ON "CliAuthToken"("pollingToken");

-- AddForeignKey
ALTER TABLE "CliAuthToken" ADD CONSTRAINT "CliAuthToken_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CliAuthToken" ADD CONSTRAINT "CliAuthToken_tenancyId_projectUserId_fkey" FOREIGN KEY ("tenancyId", "projectUserId") REFERENCES "ProjectUser"("tenancyId", "projectUserId") ON DELETE CASCADE ON UPDATE CASCADE;
