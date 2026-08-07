-- CreateEnum
CREATE TYPE "DataSourceStatus" AS ENUM ('HEALTHY', 'SYNCING', 'FAILED', 'PAUSED');

-- CreateEnum
CREATE TYPE "DataSourceSyncRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "DataSource" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "connectorId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "DataSourceStatus" NOT NULL DEFAULT 'PAUSED',
    "lastError" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "encryptedCredentials" JSONB,
    "scheduleKind" TEXT NOT NULL DEFAULT 'manual',
    "scheduleValue" TEXT,
    "nextSyncAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateTable
CREATE TABLE "DataSourceStream" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dataSourceId" UUID NOT NULL,
    "streamName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "syncMode" TEXT NOT NULL DEFAULT 'full_refresh',
    "cursorField" TEXT,
    "primaryKeyFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cursorValue" TEXT,
    "discoveredSchema" JSONB,
    "pendingDrift" JSONB,
    "lastRowCount" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "DataSourceStream_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateTable
CREATE TABLE "DataSourceSyncRun" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dataSourceId" UUID NOT NULL,
    "status" "DataSourceSyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "rowsSynced" INTEGER NOT NULL DEFAULT 0,
    "ticks" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "state" JSONB NOT NULL DEFAULT '{}',
    "claimedUntil" TIMESTAMP(3),

    CONSTRAINT "DataSourceSyncRun_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateIndex
CREATE INDEX "DataSource_tenancyId_nextSyncAt_idx" ON "DataSource"("tenancyId", "nextSyncAt");

-- CreateIndex
CREATE INDEX "DataSource_nextSyncAt_idx" ON "DataSource"("nextSyncAt");

-- CreateIndex
CREATE INDEX "DataSourceStream_tenancyId_dataSourceId_idx" ON "DataSourceStream"("tenancyId", "dataSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "DataSourceStream_tenancyId_dataSourceId_streamName_key" ON "DataSourceStream"("tenancyId", "dataSourceId", "streamName");

-- CreateIndex
CREATE INDEX "DataSourceSyncRun_tenancyId_dataSourceId_createdAt_idx" ON "DataSourceSyncRun"("tenancyId", "dataSourceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "DataSourceSyncRun_status_claimedUntil_idx" ON "DataSourceSyncRun"("status", "claimedUntil");

-- AddForeignKey
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSourceStream" ADD CONSTRAINT "DataSourceStream_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSourceStream" ADD CONSTRAINT "DataSourceStream_tenancyId_dataSourceId_fkey" FOREIGN KEY ("tenancyId", "dataSourceId") REFERENCES "DataSource"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSourceSyncRun" ADD CONSTRAINT "DataSourceSyncRun_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSourceSyncRun" ADD CONSTRAINT "DataSourceSyncRun_tenancyId_dataSourceId_fkey" FOREIGN KEY ("tenancyId", "dataSourceId") REFERENCES "DataSource"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
