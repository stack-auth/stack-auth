-- CreateTable
CREATE TABLE "SentEmail" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "senderConfig" JSONB NOT NULL,
    "to" TEXT[],
    "subject" TEXT NOT NULL,
    "html" TEXT,
    "text" TEXT,
    "error" JSONB,

    CONSTRAINT "SentEmail_pkey" PRIMARY KEY ("tenancyId","id")
);

-- AddForeignKey
ALTER TABLE "SentEmail" ADD CONSTRAINT "SentEmail_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentEmail" ADD CONSTRAINT "SentEmail_tenancyId_userId_fkey" FOREIGN KEY ("tenancyId", "userId") REFERENCES "ProjectUser"("tenancyId", "projectUserId") ON DELETE RESTRICT ON UPDATE CASCADE;
