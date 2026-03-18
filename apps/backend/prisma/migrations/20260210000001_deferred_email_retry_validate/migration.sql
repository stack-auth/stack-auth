-- Validate the deferred retry constraints added in the previous migration.
-- This runs in a separate transaction to avoid timeout, and only takes
-- SHARE UPDATE EXCLUSIVE lock (allows concurrent reads/writes).

ALTER TABLE "EmailOutbox" VALIDATE CONSTRAINT "EmailOutbox_nextSendRetryAt_requires_failure";
ALTER TABLE "EmailOutbox" VALIDATE CONSTRAINT "EmailOutbox_sendAttemptErrors_requires_failure";
ALTER TABLE "EmailOutbox" VALIDATE CONSTRAINT "EmailOutbox_no_retry_after_finished";
