-- Adds the curated-timeline override for GTM suggestions.
--
-- Both columns are nullable with no default, so this is a metadata-only change on the catalog: Postgres does not
-- rewrite the table and does not need to touch a single existing row, which is what keeps it safe on tables that
-- may hold millions of suggestions. NULL is a meaningful value here (not merely "unset") — it means no one has
-- curated this suggestion's timeline, so the dashboard keeps generating the timeline from the record's fields.

ALTER TABLE "GtmInsight"
ADD COLUMN "timelineEntries" JSONB;

ALTER TABLE "GtmAction"
ADD COLUMN "timelineEntries" JSONB;

-- Entries are always written as a whole ordered list, so the only shape the application can produce is a JSON
-- array. Constrain that at the database level too, NOT VALID so the check applies to new and updated rows without
-- scanning existing ones; every existing row is NULL and trivially satisfies it. Validated in a later migration.
ALTER TABLE "GtmInsight"
ADD CONSTRAINT "GtmInsight_timelineEntries_is_array_check"
CHECK ("timelineEntries" IS NULL OR jsonb_typeof("timelineEntries") = 'array') NOT VALID;

ALTER TABLE "GtmAction"
ADD CONSTRAINT "GtmAction_timelineEntries_is_array_check"
CHECK ("timelineEntries" IS NULL OR jsonb_typeof("timelineEntries") = 'array') NOT VALID;
