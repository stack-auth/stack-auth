-- Add source column to BranchConfigOverride
-- This tracks where the branch config was pushed from (GitHub, CLI, or dashboard)
ALTER TABLE "BranchConfigOverride" ADD COLUMN "source" JSONB;

-- Set existing rows to unlinked source (they were configured before source tracking existed)
UPDATE "BranchConfigOverride" SET "source" = '{"type": "unlinked"}' WHERE "source" IS NULL;

