-- AlterEnum: Add new skipped reasons
ALTER TYPE "EmailOutboxSkippedReason" ADD VALUE 'LIKELY_NOT_DELIVERABLE';

-- AlterTable: Add skippedDetails column
ALTER TABLE "EmailOutbox" ADD COLUMN "skippedDetails" JSONB;

-- Backfill: Set skippedDetails to empty object for existing skipped emails
UPDATE "EmailOutbox" SET "skippedDetails" = '{}'::jsonb WHERE "skippedReason" IS NOT NULL AND "skippedDetails" IS NULL;

-- DropConstraint: Remove old send_payload_when_not_finished_check
ALTER TABLE "EmailOutbox" DROP CONSTRAINT "EmailOutbox_send_payload_when_not_finished_check";

-- AddConstraint: Re-create with skippedDetails included
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_send_payload_when_not_finished_check"
    CHECK (
        "finishedSendingAt" IS NOT NULL OR (
            "sendServerErrorExternalMessage" IS NULL
            AND "sendServerErrorExternalDetails" IS NULL
            AND "sendServerErrorInternalMessage" IS NULL
            AND "sendServerErrorInternalDetails" IS NULL
            AND "skippedReason" IS NULL
            AND "skippedDetails" IS NULL
            AND "canHaveDeliveryInfo" IS NULL
            AND "deliveredAt" IS NULL
            AND "deliveryDelayedAt" IS NULL
            AND "bouncedAt" IS NULL
            AND "openedAt" IS NULL
            AND "clickedAt" IS NULL
            AND "unsubscribedAt" IS NULL
            AND "markedAsSpamAt" IS NULL
        )
    );

-- AddConstraint: Ensure skippedDetails is set iff skippedReason is set
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_skipped_details_consistency_check"
    CHECK (
        ("skippedReason" IS NULL AND "skippedDetails" IS NULL)
        OR ("skippedReason" IS NOT NULL AND "skippedDetails" IS NOT NULL)
    );
