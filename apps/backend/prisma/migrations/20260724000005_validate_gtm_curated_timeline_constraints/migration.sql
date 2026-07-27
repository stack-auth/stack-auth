-- Validates the curated-timeline array constraints added in 20260724000004.
--
-- Split into its own migration because VALIDATE CONSTRAINT scans the whole table, and each migration file runs in
-- a single transaction with a short timeout — pairing it with the ALTER TABLE above risks timing out on large
-- tables. VALIDATE takes only a SHARE UPDATE EXCLUSIVE lock, so concurrent reads and writes keep working.

ALTER TABLE "GtmInsight"
VALIDATE CONSTRAINT "GtmInsight_timelineEntries_is_array_check";

ALTER TABLE "GtmAction"
VALIDATE CONSTRAINT "GtmAction_timelineEntries_is_array_check";
