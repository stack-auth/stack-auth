ALTER TABLE "Project"
ADD COLUMN "isAvailableAsPreviewProject" BOOLEAN NOT NULL DEFAULT false;

-- Partial index for fast pool claiming: only indexes the (tiny) subset of rows
-- that are currently available, ordered by creation time so the oldest is claimed first.
CREATE INDEX "Project_isAvailableAsPreviewProject_createdAt_idx"
ON "Project" ("createdAt" ASC)
WHERE "isAvailableAsPreviewProject" = true;
