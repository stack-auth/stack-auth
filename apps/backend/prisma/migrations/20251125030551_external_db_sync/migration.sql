-- Creates a global sequence starting at 1 with increment of 11 for tracking row changes.
-- This sequence is used to order data changes across all tables in the database.
CREATE SEQUENCE  global_seq_id
    AS BIGINT
    START 1
    INCREMENT BY 11
    NO MINVALUE
    NO MAXVALUE;

-- SPLIT_STATEMENT_SENTINEL
-- Adds sequenceId column to ContactChannel and ProjectUser tables.
-- This column stores the sequence number from global_seq_id to track when each row was last modified.
ALTER TABLE "ContactChannel" ADD COLUMN  "sequenceId" BIGINT;

-- SPLIT_STATEMENT_SENTINEL
ALTER TABLE "ProjectUser" ADD COLUMN  "sequenceId" BIGINT;

-- SPLIT_STATEMENT_SENTINEL
-- Creates unique indexes on sequenceId columns to ensure no duplicate sequence IDs exist.
-- This guarantees each row has a unique position in the change sequence.
CREATE UNIQUE INDEX  "ContactChannel_sequenceId_key" ON "ContactChannel"("sequenceId");

-- SPLIT_STATEMENT_SENTINEL
CREATE UNIQUE INDEX  "ProjectUser_sequenceId_key" ON "ProjectUser"("sequenceId");

-- SPLIT_STATEMENT_SENTINEL
-- Creates composite indexes on (tenancyId, sequenceId) for efficient sync-engine queries.
-- These allow fast lookups of rows by tenant ordered by sequence number.
CREATE INDEX "ProjectUser_tenancyId_sequenceId_idx" ON "ProjectUser"("tenancyId", "sequenceId");

-- SPLIT_STATEMENT_SENTINEL
CREATE INDEX "ContactChannel_tenancyId_sequenceId_idx" ON "ContactChannel"("tenancyId", "sequenceId");

-- SPLIT_STATEMENT_SENTINEL
-- Creates OutgoingRequest table to queue sync requests to external databases.
-- Each request stores the QStash options for making HTTP requests and tracks when fulfillment started.
CREATE TABLE  "OutgoingRequest" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deduplicationKey" TEXT,
    "qstashOptions" JSONB NOT NULL,
    "startedFulfillingAt" TIMESTAMP(3),

    CONSTRAINT "OutgoingRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OutgoingRequest_deduplicationKey_key" UNIQUE ("deduplicationKey")
);

-- SPLIT_STATEMENT_SENTINEL
CREATE INDEX "OutgoingRequest_startedFulfillingAt_deduplicationKey_idx" ON "OutgoingRequest"("startedFulfillingAt", "deduplicationKey");

-- SPLIT_STATEMENT_SENTINEL
-- Creates composite index on startedFulfillingAt and createdAt for efficient querying of pending requests in order.
-- This allows fast lookups of pending requests (WHERE startedFulfillingAt IS NULL) ordered by createdAt.
CREATE INDEX  "OutgoingRequest_startedFulfillingAt_createdAt_idx" ON "OutgoingRequest"("startedFulfillingAt", "createdAt");

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

    CONSTRAINT "DeletedRow_pkey" PRIMARY KEY ("id")
);

-- SPLIT_STATEMENT_SENTINEL
-- Creates indexes on DeletedRow table for efficient querying by sequence, table name, and tenant.
CREATE UNIQUE INDEX "DeletedRow_sequenceId_key" ON "DeletedRow"("sequenceId");

-- SPLIT_STATEMENT_SENTINEL
CREATE INDEX "DeletedRow_tableName_idx" ON "DeletedRow"("tableName");

-- SPLIT_STATEMENT_SENTINEL
CREATE INDEX "DeletedRow_tenancyId_idx" ON "DeletedRow"("tenancyId");

-- SPLIT_STATEMENT_SENTINEL
-- Creates composite index for efficient querying of deleted rows by tenant and table, ordered by sequence.
CREATE INDEX "DeletedRow_tenancyId_tableName_sequenceId_idx" ON "DeletedRow"("tenancyId", "tableName", "sequenceId");

-- SPLIT_STATEMENT_SENTINEL
-- Adds shouldUpdateSequenceId flag to track which rows need their sequenceId updated.
ALTER TABLE "ProjectUser" ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT TRUE;

-- SPLIT_STATEMENT_SENTINEL
ALTER TABLE "ContactChannel" ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT TRUE;

-- SPLIT_STATEMENT_SENTINEL
ALTER TABLE "DeletedRow" ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT TRUE;

-- SPLIT_STATEMENT_SENTINEL
-- Creates partial indexes on (shouldUpdateSequenceId, tenancyId) to quickly find rows that need updates
-- and support ORDER BY tenancyId for less fragmented updates.
CREATE INDEX "ProjectUser_shouldUpdateSequenceId_idx" ON "ProjectUser"("shouldUpdateSequenceId", "tenancyId");

-- SPLIT_STATEMENT_SENTINEL
CREATE INDEX "ContactChannel_shouldUpdateSequenceId_idx" ON "ContactChannel"("shouldUpdateSequenceId", "tenancyId");

-- SPLIT_STATEMENT_SENTINEL
CREATE INDEX "DeletedRow_shouldUpdateSequenceId_idx" ON "DeletedRow"("shouldUpdateSequenceId", "tenancyId");
