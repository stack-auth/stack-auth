-- Step 3: Update the constraint (fast - just catalog updates)
-- Drop the old constraint that required finishedSendingAt for skipped fields
-- Recreate WITHOUT skippedReason and skippedDetails since skipping can now happen before sending finishes

ALTER TABLE "EmailOutbox" DROP CONSTRAINT "EmailOutbox_send_payload_when_not_finished_check";

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

