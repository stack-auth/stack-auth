-- Let terminal delivery webhook states win over the "awaiting deliveredAt"
-- branch. Resend can send bounced/delivery_delayed before deliveredAt is ever
-- set; those rows must not remain classified as SENDING.
--
-- The existing status column is STORED GENERATED, so changing its expression
-- would rewrite EmailOutbox under an ACCESS EXCLUSIVE lock. Instead, add a
-- temporary plain column, keep it current with a trigger, batch-backfill it in
-- the next migration, then swap it into place in a short final migration.

ALTER TABLE "EmailOutbox"
  ADD COLUMN "status_v2" "EmailOutboxStatus";

-- SPLIT_STATEMENT_SENTINEL

-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION stack_email_outbox_set_status_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."status_v2" :=
    CASE
      WHEN NEW."isPaused" THEN 'PAUSED'::"EmailOutboxStatus"
      WHEN NEW."skippedReason" IS NOT NULL THEN 'SKIPPED'::"EmailOutboxStatus"
      WHEN NEW."startedRenderingAt" IS NULL THEN 'PREPARING'::"EmailOutboxStatus"
      WHEN NEW."finishedRenderingAt" IS NULL THEN 'RENDERING'::"EmailOutboxStatus"
      WHEN NEW."renderErrorExternalMessage" IS NOT NULL THEN 'RENDER_ERROR'::"EmailOutboxStatus"
      WHEN NEW."startedSendingAt" IS NULL AND NEW."isQueued" IS FALSE THEN 'SCHEDULED'::"EmailOutboxStatus"
      WHEN NEW."startedSendingAt" IS NULL THEN 'QUEUED'::"EmailOutboxStatus"
      WHEN NEW."finishedSendingAt" IS NULL THEN 'SENDING'::"EmailOutboxStatus"
      WHEN NEW."sendServerErrorExternalMessage" IS NOT NULL THEN 'SERVER_ERROR'::"EmailOutboxStatus"
      WHEN NEW."canHaveDeliveryInfo" IS FALSE THEN 'SENT'::"EmailOutboxStatus"
      WHEN NEW."markedAsSpamAt" IS NOT NULL THEN 'MARKED_AS_SPAM'::"EmailOutboxStatus"
      WHEN NEW."clickedAt" IS NOT NULL THEN 'CLICKED'::"EmailOutboxStatus"
      WHEN NEW."openedAt" IS NOT NULL THEN 'OPENED'::"EmailOutboxStatus"
      WHEN NEW."bouncedAt" IS NOT NULL THEN 'BOUNCED'::"EmailOutboxStatus"
      WHEN NEW."deliveryDelayedAt" IS NOT NULL THEN 'DELIVERY_DELAYED'::"EmailOutboxStatus"
      WHEN NEW."canHaveDeliveryInfo" IS TRUE AND NEW."deliveredAt" IS NULL THEN 'SENDING'::"EmailOutboxStatus"
      ELSE 'SENT'::"EmailOutboxStatus"
    END;
  RETURN NEW;
END;
$$;

-- SPLIT_STATEMENT_SENTINEL

CREATE TRIGGER "EmailOutbox_status_v2_trigger"
BEFORE INSERT OR UPDATE ON "EmailOutbox"
FOR EACH ROW
EXECUTE FUNCTION stack_email_outbox_set_status_v2();

-- SPLIT_STATEMENT_SENTINEL

ALTER TABLE "EmailOutbox"
  ADD CONSTRAINT "EmailOutbox_status_v2_not_null_check"
  CHECK ("status_v2" IS NOT NULL)
  NOT VALID;
