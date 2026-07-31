-- Acquire and release ProjectUser's metadata lock before the larger additive
-- Comms migration takes reference locks on it. Adding a constant default is
-- metadata-only on supported PostgreSQL versions and does not rewrite the table.
ALTER TABLE "ProjectUser"
  ADD COLUMN "temp_contact_backfilled" BOOLEAN NOT NULL DEFAULT false;
