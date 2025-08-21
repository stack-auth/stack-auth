-- Grant team_admin permission to all users in the "internal" project for all teams they belong to
INSERT INTO "TeamMemberDirectPermission" ("id", "tenancyId", "projectUserId", "teamId", "permissionId", "createdAt", "updatedAt")
SELECT DISTINCT
    gen_random_uuid() AS "id",
    tm."tenancyId",
    tm."projectUserId",
    tm."teamId",
    'team_admin' AS "permissionId",
    CURRENT_TIMESTAMP AS "createdAt",
    CURRENT_TIMESTAMP AS "updatedAt"
FROM "TeamMember" tm
INNER JOIN "ProjectUser" pu ON tm."tenancyId" = pu."tenancyId" AND tm."projectUserId" = pu."projectUserId"
INNER JOIN "Tenancy" t ON pu."tenancyId" = t."id"
WHERE t."projectId" = 'internal'
    AND NOT EXISTS (
        -- Don't create duplicate permissions
        SELECT 1 
        FROM "TeamMemberDirectPermission" existing
        WHERE existing."tenancyId" = tm."tenancyId" 
            AND existing."projectUserId" = tm."projectUserId"
            AND existing."teamId" = tm."teamId"
            AND existing."permissionId" = 'team_admin'
    );