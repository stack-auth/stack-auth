-- CreateTable
CREATE TABLE "ProjectOAuthInteractionCode" (
    "id" UUID NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "interactionUid" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "clientId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "resource" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectOAuthInteractionCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectOAuthInteractionCode_codeHash_key" ON "ProjectOAuthInteractionCode"("codeHash");

-- CreateIndex
CREATE INDEX "ProjectOAuthInteractionCode_projectId_branchId_interactionU_idx" ON "ProjectOAuthInteractionCode"("projectId", "branchId", "interactionUid");

-- CreateIndex
CREATE INDEX "ProjectOAuthInteractionCode_expiresAt_idx" ON "ProjectOAuthInteractionCode"("expiresAt");

