-- Step 2: Recreate generated columns with updated logic
-- This is the slow part - requires full table rewrite to compute stored values

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

