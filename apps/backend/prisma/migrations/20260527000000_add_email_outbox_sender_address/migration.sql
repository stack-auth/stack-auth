-- Adds an optional pointer to the configured `emails.addresses` entry that an
-- email should be sent from. Nullable with no default, so this is a metadata-only
-- change in Postgres (no table rewrite) and is safe on very large tables.
ALTER TABLE "EmailOutbox"
ADD COLUMN "senderAddressId" TEXT;
