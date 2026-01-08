-- This migration allows SKIPPED status to occur at any point in the email lifecycle,
-- not just after sending has finished. This is similar to PAUSED.

-- Step 1: Drop old indexes first (before dropping columns they reference)
DROP INDEX IF EXISTS "EmailOutbox_status_tenancy_idx";
DROP INDEX IF EXISTS "EmailOutbox_simple_status_tenancy_idx";

-- Step 2: Drop both generated columns in a single ALTER TABLE
ALTER TABLE "EmailOutbox" 
  DROP COLUMN "status",
  DROP COLUMN "simpleStatus";

-- Step 3: Recreate both generated columns in a single ALTER TABLE (single table rewrite)
ALTER TABLE "EmailOutbox" 
  ADD COLUMN "status" "EmailOutboxStatus" NOT NULL GENERATED ALWAYS AS (
    CASE
        -- paused (can happen at any time)
        WHEN "isPaused" THEN 'PAUSED'::"EmailOutboxStatus"

        -- skipped (can now happen at any time, like paused)
        WHEN "skippedReason" IS NOT NULL THEN 'SKIPPED'::"EmailOutboxStatus"

        -- starting, not rendering yet
        WHEN "startedRenderingAt" IS NULL THEN 'PREPARING'::"EmailOutboxStatus"
        
        -- rendering
        WHEN "finishedRenderingAt" IS NULL THEN 'RENDERING'::"EmailOutboxStatus"

        -- rendering error
        WHEN "renderErrorExternalMessage" IS NOT NULL THEN 'RENDER_ERROR'::"EmailOutboxStatus"

        -- queued or scheduled
        WHEN "startedSendingAt" IS NULL AND "isQueued" IS FALSE THEN 'SCHEDULED'::"EmailOutboxStatus"
        WHEN "startedSendingAt" IS NULL THEN 'QUEUED'::"EmailOutboxStatus"

        -- sending
        WHEN "finishedSendingAt" IS NULL THEN 'SENDING'::"EmailOutboxStatus"
        WHEN "canHaveDeliveryInfo" IS TRUE AND "deliveredAt" IS NULL THEN 'SENDING'::"EmailOutboxStatus"

        -- failed to send
        WHEN "sendServerErrorExternalMessage" IS NOT NULL THEN 'SERVER_ERROR'::"EmailOutboxStatus"

        -- delivered successfully
        WHEN "canHaveDeliveryInfo" IS FALSE THEN 'SENT'::"EmailOutboxStatus"
        WHEN "markedAsSpamAt" IS NOT NULL THEN 'MARKED_AS_SPAM'::"EmailOutboxStatus"
        WHEN "clickedAt" IS NOT NULL THEN 'CLICKED'::"EmailOutboxStatus"
        WHEN "openedAt" IS NOT NULL THEN 'OPENED'::"EmailOutboxStatus"
        WHEN "bouncedAt" IS NOT NULL THEN 'BOUNCED'::"EmailOutboxStatus"
        WHEN "deliveryDelayedAt" IS NOT NULL THEN 'DELIVERY_DELAYED'::"EmailOutboxStatus"
        ELSE 'SENT'::"EmailOutboxStatus"
    END
  ) STORED,
  ADD COLUMN "simpleStatus" "EmailOutboxSimpleStatus" NOT NULL GENERATED ALWAYS AS (
    CASE
        -- SKIPPED is OK regardless of when it happens
        WHEN "skippedReason" IS NOT NULL THEN 'OK'::"EmailOutboxSimpleStatus"
        WHEN "renderErrorExternalMessage" IS NOT NULL OR "sendServerErrorExternalMessage" IS NOT NULL OR "bouncedAt" IS NOT NULL THEN 'ERROR'::"EmailOutboxSimpleStatus"
        WHEN "finishedSendingAt" IS NOT NULL AND ("canHaveDeliveryInfo" IS FALSE OR "deliveredAt" IS NOT NULL) THEN 'OK'::"EmailOutboxSimpleStatus"
        WHEN "finishedSendingAt" IS NULL OR ("canHaveDeliveryInfo" IS TRUE AND "deliveredAt" IS NULL) THEN 'IN_PROGRESS'::"EmailOutboxSimpleStatus"
        ELSE 'OK'::"EmailOutboxSimpleStatus"
    END
  ) STORED;

-- Step 4: Drop the old constraint that required finishedSendingAt for skipped fields
ALTER TABLE "EmailOutbox" DROP CONSTRAINT "EmailOutbox_send_payload_when_not_finished_check";

-- Step 5: Recreate the constraint WITHOUT skippedReason and skippedDetails
-- (since skipping can now happen before sending finishes)
-- Using NOT VALID for instant add, then validate separately
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_send_payload_when_not_finished_check"
    CHECK (
        "finishedSendingAt" IS NOT NULL OR (
            "sendServerErrorExternalMessage" IS NULL
            AND "sendServerErrorExternalDetails" IS NULL
            AND "sendServerErrorInternalMessage" IS NULL
            AND "sendServerErrorInternalDetails" IS NULL
            AND "canHaveDeliveryInfo" IS NULL
            AND "deliveredAt" IS NULL
            AND "deliveryDelayedAt" IS NULL
            AND "bouncedAt" IS NULL
            AND "openedAt" IS NULL
            AND "clickedAt" IS NULL
            AND "unsubscribedAt" IS NULL
            AND "markedAsSpamAt" IS NULL
        )
    ) NOT VALID;

-- Step 6: Validate the constraint (scans table but doesn't lock)
ALTER TABLE "EmailOutbox" VALIDATE CONSTRAINT "EmailOutbox_send_payload_when_not_finished_check";
