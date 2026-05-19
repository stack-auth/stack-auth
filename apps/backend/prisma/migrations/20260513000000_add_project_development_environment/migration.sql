ALTER TABLE "Project"
ADD COLUMN "isDevelopmentEnvironment" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Project"
SET "isDevelopmentEnvironment" = true
WHERE "id" IN (
  SELECT "projectId"
  FROM "LocalEmulatorProject"
);
