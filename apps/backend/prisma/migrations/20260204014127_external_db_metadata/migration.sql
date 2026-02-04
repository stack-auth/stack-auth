-- DropIndex
DROP INDEX "ContactChannel_shouldUpdateSequenceId_idx";

-- DropIndex
DROP INDEX "DeletedRow_shouldUpdateSequenceId_idx";

-- DropIndex
DROP INDEX "ProjectUser_shouldUpdateSequenceId_idx";

-- CreateTable
CREATE TABLE "ExternalDbSyncMetadata" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "singleton" "BooleanTrue" NOT NULL DEFAULT 'TRUE',
    "sequencerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pollerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "syncEngineEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalDbSyncMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalDbSyncMetadata_singleton_key" ON "ExternalDbSyncMetadata"("singleton");

