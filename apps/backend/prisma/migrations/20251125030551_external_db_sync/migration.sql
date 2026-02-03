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
    "qstashOptions" JSONB NOT NULL,
    "startedFulfillingAt" TIMESTAMP(3),

    CONSTRAINT "OutgoingRequest_pkey" PRIMARY KEY ("id")
);

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
CREATE INDEX "ProjectUser_shouldUpdateSequenceId_idx" ON "ProjectUser"("shouldUpdateSequenceId", "tenancyId") WHERE "shouldUpdateSequenceId" = TRUE;

-- SPLIT_STATEMENT_SENTINEL
CREATE INDEX "ContactChannel_shouldUpdateSequenceId_idx" ON "ContactChannel"("shouldUpdateSequenceId", "tenancyId") WHERE "shouldUpdateSequenceId" = TRUE;

-- SPLIT_STATEMENT_SENTINEL
CREATE INDEX "DeletedRow_shouldUpdateSequenceId_idx" ON "DeletedRow"("shouldUpdateSequenceId", "tenancyId") WHERE "shouldUpdateSequenceId" = TRUE;

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- Creates function that sets shouldUpdateSequenceId to TRUE whenever a row is updated.
-- This marks the row for re-syncing to external databases after any change.
CREATE FUNCTION reset_sequence_id_on_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW."shouldUpdateSequenceId" := TRUE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- SPLIT_STATEMENT_SENTINEL
-- Creates triggers that automatically mark rows for re-syncing when they are updated.
-- Only triggers when shouldUpdateSequenceId is currently FALSE to avoid unnecessary updates.
CREATE TRIGGER mark_should_update_sequence_id_project_user
BEFORE UPDATE ON "ProjectUser"
FOR EACH ROW
WHEN (OLD."shouldUpdateSequenceId" = FALSE)
EXECUTE FUNCTION reset_sequence_id_on_update();

-- SPLIT_STATEMENT_SENTINEL
CREATE TRIGGER mark_should_update_sequence_id_contact_channel
BEFORE UPDATE ON "ContactChannel"
FOR EACH ROW
WHEN (OLD."shouldUpdateSequenceId" = FALSE)
EXECUTE FUNCTION reset_sequence_id_on_update();

-- SPLIT_STATEMENT_SENTINEL
CREATE TRIGGER mark_should_update_sequence_id_deleted_row
BEFORE UPDATE ON "DeletedRow"
FOR EACH ROW
WHEN (OLD."shouldUpdateSequenceId" = FALSE)
EXECUTE FUNCTION reset_sequence_id_on_update();

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- Marks the related ProjectUser for re-sync when a ContactChannel changes.
CREATE FUNCTION mark_project_user_on_contact_channel_change()
RETURNS TRIGGER AS $function$
BEGIN
  UPDATE "ProjectUser"
  SET "shouldUpdateSequenceId" = TRUE
  WHERE "tenancyId" = NEW."tenancyId"
    AND "projectUserId" = NEW."projectUserId";
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

-- SPLIT_STATEMENT_SENTINEL
CREATE TRIGGER mark_project_user_on_contact_channel_insert
AFTER INSERT ON "ContactChannel"
FOR EACH ROW
EXECUTE FUNCTION mark_project_user_on_contact_channel_change();

-- SPLIT_STATEMENT_SENTINEL
CREATE TRIGGER mark_project_user_on_contact_channel_update
AFTER UPDATE ON "ContactChannel"
FOR EACH ROW
WHEN (OLD."tenancyId" = NEW."tenancyId" AND OLD."projectUserId" = NEW."projectUserId")
EXECUTE FUNCTION mark_project_user_on_contact_channel_change();

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- Marks the related ProjectUser for re-sync when a ContactChannel is deleted.
CREATE FUNCTION mark_project_user_on_contact_channel_delete()
RETURNS TRIGGER AS $function$
BEGIN
  UPDATE "ProjectUser"
  SET "shouldUpdateSequenceId" = TRUE
  WHERE "tenancyId" = OLD."tenancyId"
    AND "projectUserId" = OLD."projectUserId";
  RETURN OLD;
END;
$function$ LANGUAGE plpgsql;

-- SPLIT_STATEMENT_SENTINEL
CREATE TRIGGER mark_project_user_on_contact_channel_delete
AFTER DELETE ON "ContactChannel"
FOR EACH ROW
EXECUTE FUNCTION mark_project_user_on_contact_channel_delete();

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- Creates function that logs deleted rows to the DeletedRow table with their full data.
-- Extracts the primary key and row data so external databases can process the deletion.
CREATE FUNCTION log_deleted_row()
RETURNS TRIGGER AS $function$
DECLARE
  row_data jsonb;
  pk jsonb := '{}'::jsonb;
  col record;
BEGIN
  row_data := to_jsonb(OLD);

  FOR col IN
    SELECT a.attname
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = TG_RELID
      AND i.indisprimary
  LOOP
    pk := pk || jsonb_build_object(col.attname, row_data -> col.attname);
  END LOOP;
  
  INSERT INTO "DeletedRow" (
    "id",
    "tenancyId",
    "tableName",
    "primaryKey",
    "data",
    "deletedAt",
    "shouldUpdateSequenceId"
  )
  VALUES (
    gen_random_uuid(), 
    OLD."tenancyId", 
    TG_TABLE_NAME, 
    pk,
    row_data, 
    NOW(),
    TRUE
  );
  
  RETURN OLD;
END;
$function$ LANGUAGE plpgsql;

-- SPLIT_STATEMENT_SENTINEL
-- Creates triggers that automatically log deleted rows to DeletedRow table before deletion.
-- Runs before the row is deleted so all data is still available to be logged.
CREATE TRIGGER log_deleted_row_project_user
BEFORE DELETE ON "ProjectUser"
FOR EACH ROW
EXECUTE FUNCTION log_deleted_row();

-- SPLIT_STATEMENT_SENTINEL
CREATE TRIGGER log_deleted_row_contact_channel
BEFORE DELETE ON "ContactChannel"
FOR EACH ROW
EXECUTE FUNCTION log_deleted_row();

