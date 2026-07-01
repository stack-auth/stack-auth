-- Drop the retired SQL bulldozer engine tables.
--
-- These backed the old Postgres bulldozer engine (apps/bulldozer-server), which
-- has been removed in favor of bulldozer-js (LMDB). The pg_cron worker and its
-- function were dropped in the previous migration, so nothing reads or writes
-- these tables anymore. DROP TABLE is a metadata-only operation, so this is safe
-- regardless of how many rows the tables hold.
--
-- BulldozerStorageEngine is dropped last: it has a self-referential FK, but
-- DROP TABLE removes the table's own constraints, and no other table here
-- references it.
DROP TABLE IF EXISTS "BulldozerTimeFoldQueue";
DROP TABLE IF EXISTS "BulldozerTimeFoldMetadata";
DROP TABLE IF EXISTS "BulldozerTimeFoldDownstreamCascade";
DROP TABLE IF EXISTS "BulldozerStorageEngine";
