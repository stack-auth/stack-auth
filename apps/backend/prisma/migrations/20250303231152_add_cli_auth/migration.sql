-- CreateTable
CREATE TABLE "CliAuthAttempt" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "pollingCode" TEXT NOT NULL,
    "loginCode" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CliAuthAttempt_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CliAuthAttempt_pollingCode_key" ON "CliAuthAttempt"("pollingCode");

-- CreateIndex
CREATE UNIQUE INDEX "CliAuthAttempt_loginCode_key" ON "CliAuthAttempt"("loginCode");

-- AddForeignKey
ALTER TABLE "CliAuthAttempt" ADD CONSTRAINT "CliAuthAttempt_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
