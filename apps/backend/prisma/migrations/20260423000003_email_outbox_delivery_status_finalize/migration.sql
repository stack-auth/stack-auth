-- Swap the fully backfilled plain status column into place and keep it
-- as an app-maintained column. This avoids future full-table rewrites when the
-- status precedence changes again, while dropping the temporary v2 trigger once
-- the column swap is complete.

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
SELECT set_config('lock_timeout', '5s', true);

ALTER TABLE "EmailOutbox"
  VALIDATE CONSTRAINT "EmailOutbox_status_v2_not_null_check";

-- SPLIT_STATEMENT_SENTINEL

DROP TRIGGER "EmailOutbox_status_v2_trigger" ON "EmailOutbox";

-- SPLIT_STATEMENT_SENTINEL

DROP FUNCTION stack_email_outbox_set_status_v2();

-- SPLIT_STATEMENT_SENTINEL

ALTER TABLE "EmailOutbox"
  DROP COLUMN "status";

-- SPLIT_STATEMENT_SENTINEL

ALTER TABLE "EmailOutbox"
  RENAME COLUMN "status_v2" TO "status";

-- SPLIT_STATEMENT_SENTINEL

ALTER TABLE "EmailOutbox"
  ALTER COLUMN "status" SET DEFAULT 'PREPARING'::"EmailOutboxStatus",
  ALTER COLUMN "status" SET NOT NULL;

-- SPLIT_STATEMENT_SENTINEL

ALTER TABLE "EmailOutbox"
  DROP CONSTRAINT "EmailOutbox_status_v2_not_null_check";

-- SPLIT_STATEMENT_SENTINEL

ALTER TABLE "EmailOutbox"
  ADD CONSTRAINT "EmailOutbox_status_matches_fields_check"
  CHECK (
    "status" =
    CASE
      WHEN "isPaused" THEN 'PAUSED'::"EmailOutboxStatus"
      WHEN "skippedReason" IS NOT NULL THEN 'SKIPPED'::"EmailOutboxStatus"
      WHEN "startedRenderingAt" IS NULL THEN 'PREPARING'::"EmailOutboxStatus"
      WHEN "finishedRenderingAt" IS NULL THEN 'RENDERING'::"EmailOutboxStatus"
      WHEN "renderErrorExternalMessage" IS NOT NULL THEN 'RENDER_ERROR'::"EmailOutboxStatus"
      WHEN "startedSendingAt" IS NULL AND "isQueued" IS FALSE THEN 'SCHEDULED'::"EmailOutboxStatus"
      WHEN "startedSendingAt" IS NULL THEN 'QUEUED'::"EmailOutboxStatus"
      WHEN "finishedSendingAt" IS NULL THEN 'SENDING'::"EmailOutboxStatus"
      WHEN "sendServerErrorExternalMessage" IS NOT NULL THEN 'SERVER_ERROR'::"EmailOutboxStatus"
      WHEN "canHaveDeliveryInfo" IS FALSE THEN 'SENT'::"EmailOutboxStatus"
      WHEN "markedAsSpamAt" IS NOT NULL THEN 'MARKED_AS_SPAM'::"EmailOutboxStatus"
      WHEN "clickedAt" IS NOT NULL THEN 'CLICKED'::"EmailOutboxStatus"
      WHEN "openedAt" IS NOT NULL THEN 'OPENED'::"EmailOutboxStatus"
      WHEN "bouncedAt" IS NOT NULL THEN 'BOUNCED'::"EmailOutboxStatus"
      WHEN "deliveryDelayedAt" IS NOT NULL THEN 'DELIVERY_DELAYED'::"EmailOutboxStatus"
      WHEN "canHaveDeliveryInfo" IS TRUE AND "deliveredAt" IS NULL THEN 'SENDING'::"EmailOutboxStatus"
      ELSE 'SENT'::"EmailOutboxStatus"
    END
  )
  NOT VALID;

-- SPLIT_STATEMENT_SENTINEL

ALTER TABLE "EmailOutbox"
  VALIDATE CONSTRAINT "EmailOutbox_status_matches_fields_check";
