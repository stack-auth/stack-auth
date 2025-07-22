-- Drop triggers for project user count
DROP TRIGGER project_user_insert_trigger ON "ProjectUser";
DROP TRIGGER project_user_update_trigger ON "ProjectUser";
DROP TRIGGER project_user_delete_trigger ON "ProjectUser";

-- Drop function for updating project user count
DROP FUNCTION update_project_user_count();
