-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "userCount" INTEGER NOT NULL DEFAULT 0;

-- Initialize userCount for existing projects
UPDATE "Project" SET "userCount" = (
    SELECT COUNT(*) FROM "ProjectUser" 
    WHERE "ProjectUser"."mirroredProjectId" = "Project"."id"
);

-- Create function to update userCount
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION update_project_user_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Increment userCount when a new ProjectUser is added
        UPDATE "Project" SET "userCount" = "userCount" + 1
        WHERE "id" = NEW."mirroredProjectId";
    ELSIF TG_OP = 'DELETE' THEN
        -- Decrement userCount when a ProjectUser is deleted
        UPDATE "Project" SET "userCount" = "userCount" - 1
        WHERE "id" = OLD."mirroredProjectId";
    ELSIF TG_OP = 'UPDATE' AND OLD."mirroredProjectId" <> NEW."mirroredProjectId" THEN
        -- If mirroredProjectId changed, decrement count for old project and increment for new project
        UPDATE "Project" SET "userCount" = "userCount" - 1
        WHERE "id" = OLD."mirroredProjectId";
        
        UPDATE "Project" SET "userCount" = "userCount" + 1
        WHERE "id" = NEW."mirroredProjectId";
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
-- SPLIT_STATEMENT_SENTINEL

-- Create triggers
DROP TRIGGER IF EXISTS project_user_insert_trigger ON "ProjectUser";
CREATE TRIGGER project_user_insert_trigger
AFTER INSERT ON "ProjectUser"
FOR EACH ROW
EXECUTE FUNCTION update_project_user_count();

DROP TRIGGER IF EXISTS project_user_update_trigger ON "ProjectUser";
CREATE TRIGGER project_user_update_trigger
AFTER UPDATE ON "ProjectUser"
FOR EACH ROW
EXECUTE FUNCTION update_project_user_count();

DROP TRIGGER IF EXISTS project_user_delete_trigger ON "ProjectUser";
CREATE TRIGGER project_user_delete_trigger
AFTER DELETE ON "ProjectUser"
FOR EACH ROW
EXECUTE FUNCTION update_project_user_count();
