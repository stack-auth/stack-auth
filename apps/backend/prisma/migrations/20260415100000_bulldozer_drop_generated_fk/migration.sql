-- Convert keyPathParent from a GENERATED ALWAYS AS stored column to a plain
-- trigger-maintained NON-NULL column, and drop the self-referential FK.
--
-- Motivation: Prisma cannot represent nullable arrays or generated columns,
-- causing persistent schema drift in CI. Using a non-nullable array with
-- empty-array default (instead of NULL) for root rows resolves this.

-- 1. Drop the FK constraint
ALTER TABLE "BulldozerStorageEngine"
  DROP CONSTRAINT "BulldozerStorageEngine_keyPathParent_fkey";

-- 2. Convert from generated to plain column (preserves existing values)
ALTER TABLE "BulldozerStorageEngine"
  ALTER COLUMN "keyPathParent" DROP EXPRESSION;

-- 3. Backfill NULL → empty array for root rows, then add NOT NULL + DEFAULT
UPDATE "BulldozerStorageEngine"
  SET "keyPathParent" = ARRAY[]::jsonb[]
  WHERE "keyPathParent" IS NULL;

ALTER TABLE "BulldozerStorageEngine"
  ALTER COLUMN "keyPathParent" SET NOT NULL,
  ALTER COLUMN "keyPathParent" SET DEFAULT ARRAY[]::jsonb[];

-- 4. Create a trigger function to maintain keyPathParent on writes
CREATE OR REPLACE FUNCTION bulldozer_compute_key_path_parent()
RETURNS trigger LANGUAGE plpgsql AS $func$
BEGIN
  IF cardinality(NEW."keyPath") = 0 THEN
    NEW."keyPathParent" := ARRAY[]::jsonb[];
  ELSE
    NEW."keyPathParent" := NEW."keyPath"[1:cardinality(NEW."keyPath") - 1];
  END IF;
  RETURN NEW;
END;
$func$;

CREATE TRIGGER bulldozer_key_path_parent_trigger
  BEFORE INSERT OR UPDATE OF "keyPath" ON "BulldozerStorageEngine"
  FOR EACH ROW
  EXECUTE FUNCTION bulldozer_compute_key_path_parent();
