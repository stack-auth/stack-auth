-- Insight tags were display-only metadata. Remove both their values and their
-- constraints so the database cannot retain a hidden tag model after the UI is gone.
ALTER TABLE "GtmInsight"
  DROP COLUMN "kind",
  DROP COLUMN "status",
  DROP COLUMN "confidence";
