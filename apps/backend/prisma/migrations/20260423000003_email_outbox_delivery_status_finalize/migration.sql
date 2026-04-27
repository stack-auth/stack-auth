-- Swap the fully backfilled plain status column into place and keep it
-- trigger-maintained. Keep the old generated column temporarily as status_v3 so
-- the ACCESS EXCLUSIVE rename window can commit before slower verification and
-- cleanup work runs in later migrations.

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
SELECT set_config('lock_timeout', '5s', true);

ALTER TABLE "EmailOutbox"
  VALIDATE CONSTRAINT "EmailOutbox_status_v2_not_null_check";

-- SPLIT_STATEMENT_SENTINEL

ALTER TABLE "EmailOutbox"
  RENAME COLUMN "status" TO "status_v3";

-- SPLIT_STATEMENT_SENTINEL

ALTER TABLE "EmailOutbox"
  RENAME COLUMN "status_v2" TO "status";

-- SPLIT_STATEMENT_SENTINEL

ALTER TABLE "EmailOutbox"
  ALTER COLUMN "status" SET DEFAULT 'PREPARING'::"EmailOutboxStatus";

-- SPLIT_STATEMENT_SENTINEL

-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION stack_email_outbox_set_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."status" :=
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

DROP TRIGGER "EmailOutbox_status_v2_trigger" ON "EmailOutbox";

-- SPLIT_STATEMENT_SENTINEL

CREATE TRIGGER "EmailOutbox_status_trigger"
BEFORE INSERT OR UPDATE ON "EmailOutbox"
FOR EACH ROW
EXECUTE FUNCTION stack_email_outbox_set_status();

-- SPLIT_STATEMENT_SENTINEL

DROP FUNCTION stack_email_outbox_set_status_v2();
