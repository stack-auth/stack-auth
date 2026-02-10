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
