-- Step 4: Validate the constraint
-- This scans the table but only takes ShareUpdateExclusive lock (allows concurrent reads/writes)

ALTER TABLE "EmailOutbox" VALIDATE CONSTRAINT "EmailOutbox_send_payload_when_not_finished_check";

