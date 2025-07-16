-- CreateTable
CREATE TABLE "EnvironmentConfigOverride" (
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "config" JSONB NOT NULL,

    CONSTRAINT "EnvironmentConfigOverride_pkey" PRIMARY KEY ("projectId","branchId")
);

-- AddForeignKey
ALTER TABLE "EnvironmentConfigOverride" ADD CONSTRAINT "EnvironmentConfigOverride_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;


WITH
    config_ids AS (
    SELECT pc.id AS config_id
    FROM "ProjectConfig" pc
    JOIN "Project" p ON p."configId" = pc.id
    ORDER BY pc.id ASC
    ),

    -- Base project config data with project ID
    base_config AS (
    SELECT 
        pc.id AS config_id,
        p.id AS project_id,
        pc."createTeamOnSignUp",
        pc."clientTeamCreationEnabled",
        pc."teamCreateDefaultSystemPermissions",
        pc."teamMemberDefaultSystemPermissions",
        pc."allowTeamApiKeys",
        pc."signUpEnabled",
        pc."clientUserDeletionEnabled",
        pc."allowUserApiKeys",
        pc."allowLocalhost",
        pc."oauthAccountMergeStrategy"
    FROM "ProjectConfig" pc
    JOIN "Project" p ON p."configId" = pc.id
    ),

    -- Domain configuration
    domains AS (
    SELECT 
        pd."projectConfigId",
        jsonb_object_agg(
        gen_random_uuid()::text, 
        jsonb_build_object(
            'baseUrl', pd.domain,
            'handlerPath', pd."handlerPath"
        )
        ) AS trusted_domains
    FROM "ProjectDomain" pd
    GROUP BY pd."projectConfigId"
    ),

    -- Auth method configs
    auth_methods AS (
    SELECT
        a."projectConfigId",
        jsonb_object_agg(
        a.id::text,
        CASE
            WHEN p."authMethodConfigId" IS NOT NULL THEN
            jsonb_build_object('enabled', a.enabled, 'type', 'password')
            WHEN o."authMethodConfigId" IS NOT NULL THEN
            jsonb_build_object('enabled', a.enabled, 'type', 'otp')
            WHEN pk."authMethodConfigId" IS NOT NULL THEN
            jsonb_build_object('enabled', a.enabled, 'type', 'passkey')
            WHEN op."authMethodConfigId" IS NOT NULL THEN
            jsonb_build_object(
                'enabled', a.enabled, 
                'type', 'oauth', 
                'oauthProviderId', op.id
            )
            ELSE '{}'::jsonb
        END
        ) AS auth_methods
    FROM "AuthMethodConfig" a
    LEFT JOIN "PasswordAuthMethodConfig" p ON a."projectConfigId" = p."projectConfigId" AND a.id = p."authMethodConfigId"
    LEFT JOIN "OtpAuthMethodConfig" o ON a."projectConfigId" = o."projectConfigId" AND a.id = o."authMethodConfigId"
    LEFT JOIN "PasskeyAuthMethodConfig" pk ON a."projectConfigId" = pk."projectConfigId" AND a.id = pk."authMethodConfigId"
    LEFT JOIN "OAuthProviderConfig" op ON a."projectConfigId" = op."projectConfigId" AND a.id = op."authMethodConfigId"
    GROUP BY a."projectConfigId"
    ),

    -- OAuth providers
    oauth_providers AS (
    SELECT
        o."projectConfigId",
        jsonb_object_agg(
        o.id,
        CASE 
            WHEN s.id IS NOT NULL THEN
            jsonb_strip_nulls(
                jsonb_build_object(
                'type', LOWER(s.type::text),
                'isShared', false,
                'clientId', s."clientId",
                'clientSecret', s."clientSecret",
                'facebookConfigId', s."facebookConfigId",
                'microsoftTenantId', s."microsoftTenantId",
                'allowConnectedAccounts', cac.id IS NOT NULL AND COALESCE(cac.enabled, true),
                'allowSignIn', COALESCE(amc.enabled, true)
                )
            )
            WHEN p.id IS NOT NULL THEN
            jsonb_build_object(
                'type', LOWER(p.type::text),
                'isShared', true,
                'allowConnectedAccounts', cac.id IS NOT NULL AND COALESCE(cac.enabled, true),
                'allowSignIn', COALESCE(amc.enabled, true)
            )
            ELSE '{}'::jsonb
        END
        ) AS oauth_providers
    FROM "OAuthProviderConfig" o
    LEFT JOIN "StandardOAuthProviderConfig" s ON o."projectConfigId" = s."projectConfigId" AND o.id = s.id
    LEFT JOIN "ProxiedOAuthProviderConfig" p ON o."projectConfigId" = p."projectConfigId" AND o.id = p.id
    LEFT JOIN "AuthMethodConfig" amc ON o."projectConfigId" = amc."projectConfigId" AND o."authMethodConfigId" = amc."id"
    LEFT JOIN "ConnectedAccountConfig" cac ON o."projectConfigId" = cac."projectConfigId" AND o."connectedAccountConfigId" = cac."id"
    GROUP BY o."projectConfigId"
    ),

    -- Connected accounts
    connected_accounts AS (
    SELECT
        oc."projectConfigId",
        jsonb_object_agg(
        oc.id,
        jsonb_build_object(
            'enabled', COALESCE(amc.enabled, true),
            'oauthProviderId', oc.id
        )
        ) AS connected_accounts
    FROM "OAuthProviderConfig" oc
    LEFT JOIN "AuthMethodConfig" amc ON oc."projectConfigId" = amc."projectConfigId" AND oc."authMethodConfigId" = amc.id
    GROUP BY oc."projectConfigId"
    ),

    -- Email configuration
    email_config AS (
    SELECT
        e."projectConfigId",
        CASE 
        WHEN p."projectConfigId" IS NOT NULL THEN
            jsonb_build_object('isShared', true)
        WHEN s."projectConfigId" IS NOT NULL THEN
            jsonb_build_object(
            'isShared', false,
            'host', s.host,
            'port', s.port,
            'username', s.username,
            'password', s.password,
            'senderName', s."senderName",
            'senderEmail', s."senderEmail"
            )
        ELSE jsonb_build_object('isShared', true)
        END AS email_server
    FROM "EmailServiceConfig" e
    LEFT JOIN "ProxiedEmailServiceConfig" p ON e."projectConfigId" = p."projectConfigId"
    LEFT JOIN "StandardEmailServiceConfig" s ON e."projectConfigId" = s."projectConfigId"
    ),

    -- First, identify all team permissions
    team_permissions AS (
    SELECT 
        p."projectConfigId",
        p."dbId",
        p."queryableId",
        p.description
    FROM "Permission" p
    WHERE p.scope = 'TEAM'::"PermissionScope"
    ),

    -- Now identify ALL permission relationships recursively
    permission_hierarchy AS (
    -- Base case: direct edges from team permissions
    SELECT 
        tp."projectConfigId",
        tp."dbId" AS root_permission_id,
        tp."queryableId" AS root_queryable_id,
        
        -- For direct system permissions or regular permissions
        CASE 
        WHEN pe."parentTeamSystemPermission" IS NOT NULL THEN
            CASE 
            WHEN pe."parentTeamSystemPermission" = 'REMOVE_MEMBERS'::"TeamSystemPermission" THEN '$remove_members'
            WHEN pe."parentTeamSystemPermission" = 'READ_MEMBERS'::"TeamSystemPermission" THEN '$read_members'
            WHEN pe."parentTeamSystemPermission" = 'INVITE_MEMBERS'::"TeamSystemPermission" THEN '$invite_members'
            WHEN pe."parentTeamSystemPermission" = 'UPDATE_TEAM'::"TeamSystemPermission" THEN '$update_team'
            WHEN pe."parentTeamSystemPermission" = 'DELETE_TEAM'::"TeamSystemPermission" THEN '$delete_team'
            WHEN pe."parentTeamSystemPermission" = 'MANAGE_API_KEYS'::"TeamSystemPermission" THEN '$manage_api_keys'
            END
        -- For direct regular permission
        ELSE child_p."queryableId"
        END AS child_queryable_id         
    FROM team_permissions tp
    JOIN "PermissionEdge" pe ON tp."dbId" = pe."childPermissionDbId"
    LEFT JOIN "Permission" child_p ON pe."parentPermissionDbId" = child_p."dbId"
    WHERE pe."parentPermissionDbId" IS NOT NULL OR pe."parentTeamSystemPermission" IS NOT NULL
    ),

    -- Aggregate the contained permissions for each team permission
    team_contained_permissions AS (
    SELECT
        tp."projectConfigId",
        tp."queryableId",
        jsonb_object_agg(
        ph.child_queryable_id,
        'true'::jsonb
        ) FILTER (WHERE ph.child_queryable_id IS NOT NULL) AS contained_permissions
    FROM team_permissions tp
    LEFT JOIN permission_hierarchy ph ON tp."dbId" = ph.root_permission_id
    GROUP BY tp."projectConfigId", tp."queryableId"
    ),

    -- Create the final team permission definitions
    team_permission_definitions AS (
    SELECT
        tp."projectConfigId",
        jsonb_object_agg(
        tp."queryableId",
        jsonb_strip_nulls(
            jsonb_build_object(
            'description', CASE WHEN tp.description = '' THEN NULL ELSE tp.description END,
            'containedPermissionIds', COALESCE(tcp.contained_permissions, '{}'::jsonb),
            'scope', 'team'
            )
        )
        ) AS team_permission_definitions
    FROM team_permissions tp
    LEFT JOIN team_contained_permissions tcp 
        ON tp."projectConfigId" = tcp."projectConfigId" 
        AND tp."queryableId" = tcp."queryableId"
    GROUP BY tp."projectConfigId"
    ),

    -- Project permissions with the same recursive approach
    project_permissions_base AS (
    SELECT 
        p."projectConfigId",
        p."dbId",
        p."queryableId",
        p.description
    FROM "Permission" p
    WHERE p.scope = 'PROJECT'::"PermissionScope"
    ),

    -- Project permission hierarchy
    project_permission_hierarchy AS (
    -- Base case: direct edges from project permissions
    SELECT 
        pp."projectConfigId",
        pp."dbId" AS root_permission_id,
        pp."queryableId" AS root_queryable_id,
        child_p."queryableId" AS child_queryable_id
    FROM project_permissions_base pp
    JOIN "PermissionEdge" pe ON pp."dbId" = pe."childPermissionDbId"
    JOIN "Permission" child_p ON pe."parentPermissionDbId" = child_p."dbId"
    ),

    -- Aggregate the contained permissions for each project permission
    project_contained_permissions AS (
    SELECT
        pp."projectConfigId",
        pp."queryableId",
        jsonb_object_agg(
        ph.child_queryable_id,
        'true'::jsonb
        ) FILTER (WHERE ph.child_queryable_id IS NOT NULL) AS contained_permissions
    FROM project_permissions_base pp
    LEFT JOIN project_permission_hierarchy ph ON pp."dbId" = ph.root_permission_id
    GROUP BY pp."projectConfigId", pp."queryableId"
    ),

    -- Create the final project permission definitions
    project_permission_definitions AS (
    SELECT
        pp."projectConfigId",
        jsonb_object_agg(
        pp."queryableId",
        jsonb_strip_nulls(
            jsonb_build_object(
            'description', CASE WHEN pp.description = '' THEN NULL ELSE pp.description END,
            'containedPermissionIds', COALESCE(pcp.contained_permissions, '{}'::jsonb),
            'scope', 'project'
            )
        )
        ) AS project_permission_definitions
    FROM project_permissions_base pp
    LEFT JOIN project_contained_permissions pcp 
        ON pp."projectConfigId" = pcp."projectConfigId" 
        AND pp."queryableId" = pcp."queryableId"
    GROUP BY pp."projectConfigId"
    ),

    -- Default creator permissions
    default_creator_permissions AS (
    SELECT 
        p."projectConfigId",
        jsonb_object_agg(
        p."queryableId", 
        'true'::jsonb
        ) AS creator_permissions
    FROM "Permission" p
    WHERE p."isDefaultTeamCreatorPermission" = true
    GROUP BY p."projectConfigId"
    ),

    -- Default member permissions
    default_member_permissions AS (
    SELECT 
        p."projectConfigId",
        jsonb_object_agg(
        p."queryableId", 
        'true'::jsonb
        ) AS member_permissions
    FROM "Permission" p
    WHERE p."isDefaultTeamMemberPermission" = true
    GROUP BY p."projectConfigId"
    ),

    -- Default project permissions
    default_project_permissions AS (
    SELECT 
        p."projectConfigId",
        jsonb_object_agg(
        p."queryableId", 
        'true'::jsonb
        ) AS project_permissions
    FROM "Permission" p
    WHERE p."isDefaultProjectPermission" = true
    GROUP BY p."projectConfigId"
    ),

    -- System permissions for team creators
    team_create_system_permissions AS (
    SELECT 
        pc.id AS "projectConfigId",
        jsonb_object_agg(
        CASE 
            WHEN perm = 'REMOVE_MEMBERS'::"TeamSystemPermission" THEN '$remove_members'
            WHEN perm = 'READ_MEMBERS'::"TeamSystemPermission" THEN '$read_members'
            WHEN perm = 'INVITE_MEMBERS'::"TeamSystemPermission" THEN '$invite_members'
            WHEN perm = 'UPDATE_TEAM'::"TeamSystemPermission" THEN '$update_team'
            WHEN perm = 'DELETE_TEAM'::"TeamSystemPermission" THEN '$delete_team'
            WHEN perm = 'MANAGE_API_KEYS'::"TeamSystemPermission" THEN '$manage_api_keys'
            ELSE perm::text
        END,
        'true'::jsonb
        ) AS system_permissions
    FROM "ProjectConfig" pc
    CROSS JOIN UNNEST(pc."teamCreateDefaultSystemPermissions") AS perm
    WHERE pc."teamCreateDefaultSystemPermissions" IS NOT NULL 
        AND array_length(pc."teamCreateDefaultSystemPermissions", 1) > 0
    GROUP BY pc.id
    ),

    -- System permissions for team members
    team_member_system_permissions AS (
    SELECT 
        pc.id AS "projectConfigId",
        jsonb_object_agg(
        CASE 
            WHEN perm = 'REMOVE_MEMBERS'::"TeamSystemPermission" THEN '$remove_members'
            WHEN perm = 'READ_MEMBERS'::"TeamSystemPermission" THEN '$read_members'
            WHEN perm = 'INVITE_MEMBERS'::"TeamSystemPermission" THEN '$invite_members'
            WHEN perm = 'UPDATE_TEAM'::"TeamSystemPermission" THEN '$update_team'
            WHEN perm = 'DELETE_TEAM'::"TeamSystemPermission" THEN '$delete_team'
            WHEN perm = 'MANAGE_API_KEYS'::"TeamSystemPermission" THEN '$manage_api_keys'
            ELSE perm::text
        END,
        'true'::jsonb
        ) AS system_permissions
    FROM "ProjectConfig" pc
    CROSS JOIN UNNEST(pc."teamMemberDefaultSystemPermissions") AS perm
    WHERE pc."teamMemberDefaultSystemPermissions" IS NOT NULL 
        AND array_length(pc."teamMemberDefaultSystemPermissions", 1) > 0
    GROUP BY pc.id
    ),

    -- Final combined query
    final AS (
    SELECT
        bc.config_id,
        bc.project_id,
        jsonb_build_object(
        'rbac', jsonb_build_object(
            'permissions', COALESCE(tpd.team_permission_definitions, '{}'::jsonb) || 
                        COALESCE(ppd.project_permission_definitions, '{}'::jsonb),
            'defaultPermissions', jsonb_build_object(
            'teamCreator', CASE 
                WHEN dcp.creator_permissions IS NOT NULL AND tcsp.system_permissions IS NOT NULL THEN
                dcp.creator_permissions || tcsp.system_permissions
                WHEN dcp.creator_permissions IS NOT NULL THEN dcp.creator_permissions
                WHEN tcsp.system_permissions IS NOT NULL THEN tcsp.system_permissions
                ELSE '{}'::jsonb
            END,
            'teamMember', CASE 
                WHEN dmp.member_permissions IS NOT NULL AND tmsp.system_permissions IS NOT NULL THEN
                dmp.member_permissions || tmsp.system_permissions
                WHEN dmp.member_permissions IS NOT NULL THEN dmp.member_permissions
                WHEN tmsp.system_permissions IS NOT NULL THEN tmsp.system_permissions
                ELSE '{}'::jsonb
            END,
            'signUp', COALESCE(dpp.project_permissions, '{}'::jsonb)
            )
        ),
        'teams', jsonb_build_object(
            'createPersonalTeamOnSignUp', bc."createTeamOnSignUp",
            'allowClientTeamCreation', bc."clientTeamCreationEnabled"
        ),
        'users', jsonb_build_object(
            'allowClientUserDeletion', bc."clientUserDeletionEnabled"
        ),
        'apiKeys', jsonb_build_object(
            'enabled', jsonb_build_object(
            'team', bc."allowTeamApiKeys",
            'user', bc."allowUserApiKeys"
            )
        ),
        'domains', jsonb_build_object(
            'allowLocalhost', bc."allowLocalhost",
            'trustedDomains', COALESCE(d.trusted_domains, '{}'::jsonb)
        ),
        'auth', jsonb_build_object(
            'allowSignUp', bc."signUpEnabled",
            'password', jsonb_build_object(
            'allowSignIn', COALESCE(
                (SELECT (am.auth_methods->key->>'enabled')::boolean 
                FROM jsonb_each(am.auth_methods) key 
                WHERE am.auth_methods->key->>'type' = 'password'
                LIMIT 1),
                false
            )
            ),
            'otp', jsonb_build_object(
            'allowSignIn', COALESCE(
                (SELECT (am.auth_methods->key->>'enabled')::boolean 
                FROM jsonb_each(am.auth_methods) key 
                WHERE am.auth_methods->key->>'type' = 'otp'
                LIMIT 1),
                false
            )
            ),
            'passkey', jsonb_build_object(
            'allowSignIn', COALESCE(
                (SELECT (am.auth_methods->key->>'enabled')::boolean 
                FROM jsonb_each(am.auth_methods) key 
                WHERE am.auth_methods->key->>'type' = 'passkey'
                LIMIT 1),
                false
            )
            ),
            'oauth', jsonb_build_object(
            'accountMergeStrategy', LOWER(REPLACE(bc."oauthAccountMergeStrategy"::text, '_', '_')),
            'providers', COALESCE(op.oauth_providers, '{}'::jsonb)
            )
        ),
        'emails', jsonb_build_object(
            'server', COALESCE(ec.email_server, '{"isShared": true}'::jsonb)
        )
        ) AS config
    FROM base_config bc
    LEFT JOIN domains d ON bc.config_id = d."projectConfigId"
    LEFT JOIN auth_methods am ON bc.config_id = am."projectConfigId"
    LEFT JOIN oauth_providers op ON bc.config_id = op."projectConfigId"
    LEFT JOIN connected_accounts ca ON bc.config_id = ca."projectConfigId"
    LEFT JOIN email_config ec ON bc.config_id = ec."projectConfigId"
    LEFT JOIN team_permission_definitions tpd ON bc.config_id = tpd."projectConfigId"
    LEFT JOIN project_permission_definitions ppd ON bc.config_id = ppd."projectConfigId"
    LEFT JOIN default_creator_permissions dcp ON bc.config_id = dcp."projectConfigId"
    LEFT JOIN default_member_permissions dmp ON bc.config_id = dmp."projectConfigId"
    LEFT JOIN default_project_permissions dpp ON bc.config_id = dpp."projectConfigId"
    LEFT JOIN team_create_system_permissions tcsp ON bc.config_id = tcsp."projectConfigId"
    LEFT JOIN team_member_system_permissions tmsp ON bc.config_id = tmsp."projectConfigId"
    ORDER BY bc.config_id
    )

    -- fill EnvironmentConfigOverride with the data from final
    INSERT INTO "EnvironmentConfigOverride" ("projectId", "branchId", "config", "updatedAt")
    SELECT project_id, 'main', config, NOW()
    FROM final;
