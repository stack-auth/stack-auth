-- Rebrand: rename the internal-project display name and description from
-- "Stack Dashboard" / "Stack's admin dashboard" to "Hexclave Dashboard" /
-- "Hexclave's admin dashboard". Idempotent: only updates the row if it still
-- holds the pre-rebrand defaults for BOTH fields, so any operator who renamed
-- the internal project themselves (or even just one field) is left untouched.
-- Re-running the migration after the rename is a no-op. Missing row (fresh
-- install before seed) is also a no-op.

UPDATE "Project"
SET "displayName" = 'Hexclave Dashboard',
    "description" = 'Hexclave''s admin dashboard'
WHERE "id" = 'internal'
  AND "displayName" = 'Stack Dashboard'
  AND "description" = 'Stack''s admin dashboard';
