CREATE SEQUENCE  global_seq_id
    AS BIGINT
    START 1
    INCREMENT BY 11
    NO MINVALUE
    NO MAXVALUE;

-- SPLIT_STATEMENT_SENTINEL
ALTER TABLE "ContactChannel" ADD COLUMN  "sequenceId" BIGINT;

-- SPLIT_STATEMENT_SENTINEL
ALTER TABLE "ProjectUser" ADD COLUMN  "sequenceId" BIGINT;

-- SPLIT_STATEMENT_SENTINEL
CREATE UNIQUE INDEX  "ContactChannel_sequenceId_key" ON "ContactChannel"("sequenceId");

-- SPLIT_STATEMENT_SENTINEL
CREATE UNIQUE INDEX  "ProjectUser_sequenceId_key" ON "ProjectUser"("sequenceId");
