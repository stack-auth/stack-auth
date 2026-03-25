-- Drop the existing full unique constraint on deduplicationKey
ALTER TABLE "OutgoingRequest" DROP CONSTRAINT "OutgoingRequest_deduplicationKey_key";

-- SPLIT_STATEMENT_SENTINEL
-- Create a partial unique index that only enforces uniqueness for rows
-- where startedFulfillingAt IS NULL (i.e. pending/unclaimed requests).
-- This allows duplicate deduplicationKey values for rows that have already
-- been claimed for processing.
CREATE UNIQUE INDEX "OutgoingRequest_deduplicationKey_pending_key"
  ON "OutgoingRequest" ("deduplicationKey")
  WHERE "startedFulfillingAt" IS NULL;
