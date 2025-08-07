-- SINGLE_STATEMENT_SENTINEL
-- Add team-based project ownership
-- Step 1: Add ownerTeamId column to Project table
ALTER TABLE "Project" ADD COLUMN "ownerTeamId" UUID;

-- Step 2: For each existing user with managed projects, create a personal team and assign their projects to it
DO $$
DECLARE
    user_record RECORD;
    project_id_text TEXT;
    team_uuid UUID;
    managed_project_ids JSONB;
BEGIN
    -- Loop through all users in the 'internal' project who have managed projects
    FOR user_record IN 
        SELECT 
            "tenancyId",
            "projectUserId", 
            "displayName",
            "mirroredProjectId",
            "mirroredBranchId",
            "serverMetadata"
        FROM "ProjectUser" 
        WHERE "mirroredProjectId" = 'internal' 
        AND "serverMetadata" IS NOT NULL 
        AND "serverMetadata"::jsonb ? 'managedProjectIds'
    LOOP
        -- Extract managedProjectIds from serverMetadata
        managed_project_ids := user_record."serverMetadata"::jsonb -> 'managedProjectIds';
        
        -- Skip if managedProjectIds is not an array or is empty
        IF managed_project_ids IS NULL OR jsonb_array_length(managed_project_ids) = 0 THEN
            CONTINUE;
        END IF;
        
        -- Create a personal team for this user
        team_uuid := gen_random_uuid();
        
        INSERT INTO "Team" (
            "tenancyId",
            "teamId",
            "mirroredProjectId", 
            "mirroredBranchId",
            "displayName",
            "createdAt",
            "updatedAt"
        ) VALUES (
            user_record."tenancyId",
            team_uuid,
            user_record."mirroredProjectId",
            user_record."mirroredBranchId", 
            COALESCE(user_record."displayName", 'User') || '''s Team',
            NOW(),
            NOW()
        );
        
        -- Add the user as a team member
        INSERT INTO "TeamMember" (
            "tenancyId",
            "projectUserId",
            "teamId",
            "isSelected",
            "createdAt",
            "updatedAt"
        ) VALUES (
            user_record."tenancyId",
            user_record."projectUserId",
            team_uuid,
            'TRUE',
            NOW(),
            NOW()
        );
        
        -- Assign all managed projects to this team
        FOR i IN 0..jsonb_array_length(managed_project_ids) - 1
        LOOP
            project_id_text := managed_project_ids ->> i;
            
            UPDATE "Project" 
            SET "ownerTeamId" = team_uuid
            WHERE "id" = project_id_text;
        END LOOP;
        
        RAISE NOTICE 'Created team % for user % with % managed projects', 
            team_uuid, user_record."displayName", jsonb_array_length(managed_project_ids);
    END LOOP;
END $$;
