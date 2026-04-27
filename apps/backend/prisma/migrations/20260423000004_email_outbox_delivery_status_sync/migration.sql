-- Verify the swapped plain status column outside the short rename transaction.
-- If any rows somehow missed the v2 backfill while the old generated column has
-- a value, copy that generated value over before making the plain column NOT NULL.

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
SELECT set_config('lock_timeout', '5s', true);

-- SPLIT_STATEMENT_SENTINEL

-- SINGLE_STATEMENT_SENTINEL
WITH status_counts AS (
  SELECT
    COUNT(*) FILTER (WHERE "status_v3" IS NOT NULL) AS status_v3_count,
    COUNT(*) FILTER (WHERE "status" IS NOT NULL) AS status_count
  FROM "EmailOutbox"
),
sync_missing AS (
  UPDATE "EmailOutbox"
  SET "status" = "status_v3"
  WHERE "status" IS NULL
    AND "status_v3" IS NOT NULL
    AND (SELECT status_v3_count > status_count FROM status_counts)
  RETURNING 1
)
SELECT COUNT(*) AS synced_missing_status_rows FROM sync_missing;

-- SPLIT_STATEMENT_SENTINEL

ALTER TABLE "EmailOutbox"
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
