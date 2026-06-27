-- CreateTable
CREATE TABLE "ConfigAgentRun" (
    "id" UUID NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "commitUrl" TEXT,
    "error" TEXT,
    "sandboxId" TEXT,
    "progress" TEXT,
    "stage" TEXT,
    "diff" TEXT,
    "baseCommitSha" TEXT,

    CONSTRAINT "ConfigAgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConfigAgentRun_projectId_branchId_idx" ON "ConfigAgentRun"("projectId", "branchId");

-- AddForeignKey
ALTER TABLE "ConfigAgentRun" ADD CONSTRAINT "ConfigAgentRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
