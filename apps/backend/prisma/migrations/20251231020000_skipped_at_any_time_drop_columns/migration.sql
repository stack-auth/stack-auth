-- This migration allows SKIPPED status to occur at any point in the email lifecycle,
-- not just after sending has finished. This is similar to PAUSED.
--
-- Step 1: Drop old indexes and columns (fast operations - just catalog updates)

DROP INDEX IF EXISTS "EmailOutbox_status_tenancy_idx";
DROP INDEX IF EXISTS "EmailOutbox_simple_status_tenancy_idx";

ALTER TABLE "EmailOutbox" 
  DROP COLUMN "status",
  DROP COLUMN "simpleStatus";

