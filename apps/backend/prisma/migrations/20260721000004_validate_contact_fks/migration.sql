-- Validate before SET NOT NULL so PostgreSQL can reuse the proven check instead
-- of rescanning the table while holding an ACCESS EXCLUSIVE lock.
ALTER TABLE "ContactChannel"
  VALIDATE CONSTRAINT "ContactChannel_contactId_not_null";
