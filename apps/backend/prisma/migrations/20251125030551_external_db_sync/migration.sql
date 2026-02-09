-- Creates a global sequence starting at 1 with increment of 11 for tracking row changes.
-- This sequence is used to order data changes across all tables in the database.
CREATE SEQUENCE global_seq_id
    AS BIGINT
    START 1
    INCREMENT BY 11
    NO MINVALUE
    NO MAXVALUE;

-- SPLIT_STATEMENT_SENTINEL
-- Adds sequenceId and shouldUpdateSequenceId columns to ContactChannel and ProjectUser tables.
-- sequenceId stores the sequence number from global_seq_id to track when each row was last modified.
-- shouldUpdateSequenceId is a flag to track which rows need their sequenceId updated.
ALTER TABLE "ContactChannel" ADD COLUMN "sequenceId" BIGINT;

-- SPLIT_STATEMENT_SENTINEL
ALTER TABLE "ContactChannel" ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT TRUE;

-- SPLIT_STATEMENT_SENTINEL
ALTER TABLE "ProjectUser" ADD COLUMN "sequenceId" BIGINT;

-- SPLIT_STATEMENT_SENTINEL
ALTER TABLE "ProjectUser" ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT TRUE;

-- SPLIT_STATEMENT_SENTINEL
-- Creates OutgoingRequest table to queue sync requests to external databases.
-- Each request stores the QStash options for making HTTP requests and tracks when fulfillment started.
CREATE TABLE "OutgoingRequest" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deduplicationKey" TEXT,
    "qstashOptions" JSONB NOT NULL,
    "startedFulfillingAt" TIMESTAMP(3),

    CONSTRAINT "OutgoingRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OutgoingRequest_deduplicationKey_key" UNIQUE ("deduplicationKey")
);

-- SPLIT_STATEMENT_SENTINEL
-- Creates DeletedRow table to log information about deleted rows from other tables.
-- Stores the primary key and full data of deleted rows so external databases can be notified of deletions.
CREATE TABLE "DeletedRow" (
    "id" UUID NOT NULL,
    "tenancyId" UUID NOT NULL,
    "tableName" TEXT NOT NULL,
    "sequenceId" BIGINT,
    "primaryKey" JSONB NOT NULL,
    "data" JSONB,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedFulfillingAt" TIMESTAMP(3),
    "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT "DeletedRow_pkey" PRIMARY KEY ("id")
);

-- SPLIT_STATEMENT_SENTINEL
-- Creates ExternalDbSyncMetadata table to store external database sync configuration.
-- Uses a singleton constraint to ensure only one row exists.
CREATE TABLE "ExternalDbSyncMetadata" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "singleton" "BooleanTrue" NOT NULL DEFAULT 'TRUE'::"BooleanTrue",
    "sequencerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pollerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalDbSyncMetadata_pkey" PRIMARY KEY ("id")
);

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
-- Creates unique indexes on sequenceId columns to ensure no duplicate sequence IDs exist.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "ContactChannel_sequenceId_key" ON /* SCHEMA_NAME_SENTINEL */."ContactChannel"("sequenceId");

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "ProjectUser_sequenceId_key" ON /* SCHEMA_NAME_SENTINEL */."ProjectUser"("sequenceId");

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "DeletedRow_sequenceId_key" ON /* SCHEMA_NAME_SENTINEL */."DeletedRow"("sequenceId");

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "ExternalDbSyncMetadata_singleton_key" ON /* SCHEMA_NAME_SENTINEL */."ExternalDbSyncMetadata"("singleton");

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
-- Creates composite indexes on (tenancyId, sequenceId) for efficient sync-engine queries.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProjectUser_tenancyId_sequenceId_idx" ON /* SCHEMA_NAME_SENTINEL */."ProjectUser"("tenancyId", "sequenceId");

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ContactChannel_tenancyId_sequenceId_idx" ON /* SCHEMA_NAME_SENTINEL */."ContactChannel"("tenancyId", "sequenceId");

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "OutgoingRequest_startedFulfillingAt_deduplicationKey_idx" ON /* SCHEMA_NAME_SENTINEL */."OutgoingRequest"("startedFulfillingAt", "deduplicationKey");

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "OutgoingRequest_startedFulfillingAt_createdAt_idx" ON /* SCHEMA_NAME_SENTINEL */."OutgoingRequest"("startedFulfillingAt", "createdAt");

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "DeletedRow_tableName_idx" ON /* SCHEMA_NAME_SENTINEL */."DeletedRow"("tableName");

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "DeletedRow_tenancyId_idx" ON /* SCHEMA_NAME_SENTINEL */."DeletedRow"("tenancyId");

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
-- Creates composite index for efficient querying of deleted rows by tenant and table, ordered by sequence.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "DeletedRow_tenancyId_tableName_sequenceId_idx" ON /* SCHEMA_NAME_SENTINEL */."DeletedRow"("tenancyId", "tableName", "sequenceId");

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
-- Creates indexes on (shouldUpdateSequenceId, tenancyId) to quickly find rows that need updates
-- and support ORDER BY tenancyId for less fragmented updates.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProjectUser_shouldUpdateSequenceId_idx" ON /* SCHEMA_NAME_SENTINEL */."ProjectUser"("shouldUpdateSequenceId", "tenancyId");

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ContactChannel_shouldUpdateSequenceId_idx" ON /* SCHEMA_NAME_SENTINEL */."ContactChannel"("shouldUpdateSequenceId", "tenancyId");

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "DeletedRow_shouldUpdateSequenceId_idx" ON /* SCHEMA_NAME_SENTINEL */."DeletedRow"("shouldUpdateSequenceId", "tenancyId");
