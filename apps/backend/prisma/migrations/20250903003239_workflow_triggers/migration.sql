-- CreateTable
CREATE TABLE "WorkflowTriggerToken" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTriggerToken_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTriggerToken_tenancyId_tokenHash_key" ON "WorkflowTriggerToken"("tenancyId", "tokenHash");
