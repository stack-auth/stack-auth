-- Add deferred retry fields for email sending
-- These fields allow the email queue to schedule retries for later iterations
-- instead of blocking the current iteration with inline retries.

ALTER TABLE "EmailOutbox"
  ADD COLUMN "sendRetries" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextSendRetryAt" TIMESTAMP(3),
  ADD COLUMN "sendAttemptErrors" JSONB;

-- Constraint: nextSendRetryAt can only be set after at least one failed attempt
-- (if sendRetries is 0, no attempt has failed, so there's nothing to retry)
ALTER TABLE "EmailOutbox"
  ADD CONSTRAINT "EmailOutbox_nextSendRetryAt_requires_failure"
  CHECK ("nextSendRetryAt" IS NULL OR "sendRetries" > 0);

-- Constraint: sendAttemptErrors can only be set after at least one failed attempt
ALTER TABLE "EmailOutbox"
  ADD CONSTRAINT "EmailOutbox_sendAttemptErrors_requires_failure"
  CHECK ("sendAttemptErrors" IS NULL OR "sendRetries" > 0);

-- Constraint: nextSendRetryAt must be null when email has finished sending
-- (if finishedSendingAt is set, there's nothing more to retry)
ALTER TABLE "EmailOutbox"
  ADD CONSTRAINT "EmailOutbox_no_retry_after_finished"
  CHECK ("finishedSendingAt" IS NULL OR "nextSendRetryAt" IS NULL);
