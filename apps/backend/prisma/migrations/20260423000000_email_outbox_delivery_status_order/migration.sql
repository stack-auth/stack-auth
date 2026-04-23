-- Let terminal delivery webhook states win over the "awaiting deliveredAt"
-- branch. Resend can send bounced/delivery_delayed before deliveredAt is ever
-- set; those rows must not remain classified as SENDING.

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
DROP INDEX CONCURRENTLY IF EXISTS "EmailOutbox_status_tenancy_idx";

-- SPLIT_STATEMENT_SENTINEL

-- Keep the table rewrite bounded by the migration transaction timeout instead
-- of the shorter default statement timeout.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
SET LOCAL statement_timeout = '75s';

-- SPLIT_STATEMENT_SENTINEL

ALTER TABLE "EmailOutbox"
  DROP COLUMN "status";

ALTER TABLE "EmailOutbox"
  ADD COLUMN "status" "EmailOutboxStatus" NOT NULL GENERATED ALWAYS AS (
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
  ) STORED;
