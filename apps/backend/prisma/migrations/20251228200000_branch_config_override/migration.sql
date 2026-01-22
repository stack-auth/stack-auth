-- CreateTable
CREATE TABLE "BranchConfigOverride" (
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "config" JSONB NOT NULL,

    CONSTRAINT "BranchConfigOverride_pkey" PRIMARY KEY ("projectId","branchId")
);

-- AddForeignKey
ALTER TABLE "BranchConfigOverride" ADD CONSTRAINT "BranchConfigOverride_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

