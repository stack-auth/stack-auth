-- Add team-based project ownership
-- Step 1: Add ownerTeamId column to Project table
ALTER TABLE "Project" ADD COLUMN "ownerTeamId" UUID;

--SPLIT_STATEMENT_SENTINEL

-- SINGLE_STATEMENT_SENTINEL
-- Step 2: For each existing user with managed projects, create a personal team and assign their projects to it
DO $$
DECLARE
    user_record RECORD;
    project_id_text TEXT;
    team_uuid UUID;
    managed_project_ids JSONB;
    owners_count INTEGER;
    existing_owner_team_uuid UUID;
    group_team_uuid UUID;
    group_project_display_name TEXT;
BEGIN
    -- Loop through all users in the 'internal' project who have managed projects
    FOR user_record IN 
        SELECT 
            pu."tenancyId",
            pu."projectUserId", 
            pu."displayName",
            pu."mirroredProjectId",
            pu."mirroredBranchId",
            pu."serverMetadata",
            cc."value" as contact_value
        FROM "ProjectUser" pu
        LEFT JOIN "ContactChannel" cc 
          ON cc."projectUserId" = pu."projectUserId"
          AND cc."type" = 'EMAIL'
          AND cc."isPrimary" = 'TRUE'
        WHERE pu."mirroredProjectId" = 'internal' 
        AND pu."serverMetadata" IS NOT NULL 
        AND pu."serverMetadata"::jsonb ? 'managedProjectIds'
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
            COALESCE(user_record."displayName", user_record.contact_value, 'User') || '''s Team',
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
            NULL,
            NOW(),
            NOW()
        );
        
        -- Assign all managed projects to this team
        FOR i IN 0..jsonb_array_length(managed_project_ids) - 1
        LOOP
            project_id_text := managed_project_ids ->> i;
            -- Determine how many users own/manage this project
            SELECT COUNT(*) INTO owners_count
            FROM "ProjectUser" pu
            WHERE pu."mirroredProjectId" = 'internal'
              AND pu."serverMetadata" IS NOT NULL
              AND (pu."serverMetadata"::jsonb ? 'managedProjectIds')
              AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(pu."serverMetadata"::jsonb -> 'managedProjectIds') AS elem
                WHERE elem = project_id_text
              );

            IF owners_count = 1 THEN
                -- Single owner: assign to the personal team
                UPDATE "Project"
                SET "ownerTeamId" = team_uuid
                WHERE "id" = project_id_text;
            ELSE
                -- Multiple owners: ensure there is a shared team for all owners and assign the project to it
                SELECT "ownerTeamId" INTO existing_owner_team_uuid
                FROM "Project"
                WHERE "id" = project_id_text;

                IF existing_owner_team_uuid IS NULL THEN
                    -- Create a shared team for this project's owners (only once)
                    group_team_uuid := gen_random_uuid();

                    -- Use project display name if available for a nicer team name
                    SELECT COALESCE(p."displayName", 'Project') INTO group_project_display_name
                    FROM "Project" p
                    WHERE p."id" = project_id_text;

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
                        group_team_uuid,
                        user_record."mirroredProjectId",
                        user_record."mirroredBranchId",
                        group_project_display_name || ' Owners',
                        NOW(),
                        NOW()
                    );

                    -- Add all owners as members of the shared team with isSelected unset (NULL)
                    INSERT INTO "TeamMember" (
                        "tenancyId",
                        "projectUserId",
                        "teamId",
                        "createdAt",
                        "updatedAt"
                    )
                    SELECT
                        user_record."tenancyId",
                        pu."projectUserId",
                        group_team_uuid,
                        NOW(),
                        NOW()
                    FROM "ProjectUser" pu
                    WHERE pu."mirroredProjectId" = 'internal'
                      AND pu."serverMetadata" IS NOT NULL
                      AND (pu."serverMetadata"::jsonb ? 'managedProjectIds')
                      AND EXISTS (
                        SELECT 1
                        FROM jsonb_array_elements_text(pu."serverMetadata"::jsonb -> 'managedProjectIds') AS elem
                        WHERE elem = project_id_text
                      )
                    ON CONFLICT ("tenancyId", "projectUserId", "teamId") DO NOTHING;

                    -- Point the project to the shared team
                    UPDATE "Project"
                    SET "ownerTeamId" = group_team_uuid
                    WHERE "id" = project_id_text;
                ELSE
                    -- Shared team already exists: ensure current and all owners are members; then ensure project points to it
                    INSERT INTO "TeamMember" (
                        "tenancyId",
                        "projectUserId",
                        "teamId",
                        "createdAt",
                        "updatedAt"
                    )
                    SELECT
                        user_record."tenancyId",
                        pu."projectUserId",
                        existing_owner_team_uuid,
                        NOW(),
                        NOW()
                    FROM "ProjectUser" pu
                    WHERE pu."mirroredProjectId" = 'internal'
                      AND pu."serverMetadata" IS NOT NULL
                      AND (pu."serverMetadata"::jsonb ? 'managedProjectIds')
                      AND EXISTS (
                        SELECT 1
                        FROM jsonb_array_elements_text(pu."serverMetadata"::jsonb -> 'managedProjectIds') AS elem
                        WHERE elem = project_id_text
                      )
                    ON CONFLICT ("tenancyId", "projectUserId", "teamId") DO NOTHING;

                    UPDATE "Project"
                    SET "ownerTeamId" = existing_owner_team_uuid
                    WHERE "id" = project_id_text;
                END IF;
            END IF;
        END LOOP;
        
    END LOOP;
END $$;
