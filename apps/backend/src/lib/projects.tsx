import { RawQuery, prismaClient, rawQuery, retryTransaction } from "@/prisma-client";
import { Prisma, TeamSystemPermission } from "@prisma/client";
import { InternalProjectsCrud, ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, captureError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { deepPlainEquals, isNotNull, omit } from "@stackframe/stack-shared/dist/utils/objects";
import { stringCompare, typedToLowercase, typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { fullPermissionInclude, teamPermissionDefinitionJsonFromDbType, teamPermissionDefinitionJsonFromRawDbType, teamPermissionDefinitionJsonFromTeamSystemDbType } from "./permissions";
import { ensureSharedProvider, ensureStandardProvider } from "./request-checks";

export const fullProjectInclude = {
  config: {
    include: {
      oauthProviderConfigs: {
        include: {
          proxiedOAuthConfig: true,
          standardOAuthConfig: true,
        },
      },
      emailServiceConfig: {
        include: {
          proxiedEmailServiceConfig: true,
          standardEmailServiceConfig: true,
        },
      },
      permissions: {
        include: fullPermissionInclude,
      },
      authMethodConfigs: {
        include: {
          oauthProviderConfig: {
            include: {
              proxiedOAuthConfig: true,
              standardOAuthConfig: true,
            },
          },
          otpConfig: true,
          passwordConfig: true,
          passkeyConfig: true,
        }
      },
      connectedAccountConfigs: {
        include: {
          oauthProviderConfig: {
            include: {
              proxiedOAuthConfig: true,
              standardOAuthConfig: true,
            },
          },
        }
      },
      domains: true,
    },
  },
  _count: {
    select: {
      projectUsers: true,
    },
  },
} as const satisfies Prisma.ProjectInclude;

export type ProjectDB = Prisma.ProjectGetPayload<{ include: typeof fullProjectInclude }> & {
  config: {
    oauthProviderConfigs: (Prisma.OAuthProviderConfigGetPayload<
      typeof fullProjectInclude.config.include.oauthProviderConfigs
    >)[],
    emailServiceConfig: Prisma.EmailServiceConfigGetPayload<
      typeof fullProjectInclude.config.include.emailServiceConfig
    > | null,
    domains: Prisma.ProjectDomainGetPayload<
      typeof fullProjectInclude.config.include.domains
    >[],
    permissions: Prisma.PermissionGetPayload<
      typeof fullProjectInclude.config.include.permissions
    >[],
  },
};

export function projectPrismaToCrud(
  prisma: Prisma.ProjectGetPayload<{ include: typeof fullProjectInclude }>
): ProjectsCrud["Admin"]["Read"] {
  const oauthProviders = prisma.config.authMethodConfigs
    .map((config) => {
      if (config.oauthProviderConfig) {
        const providerConfig = config.oauthProviderConfig;
        if (providerConfig.proxiedOAuthConfig) {
          return {
            id: typedToLowercase(providerConfig.proxiedOAuthConfig.type),
            enabled: config.enabled,
            type: "shared",
          } as const;
        } else if (providerConfig.standardOAuthConfig) {
          return {
            id: typedToLowercase(providerConfig.standardOAuthConfig.type),
            enabled: config.enabled,
            type: "standard",
            client_id: providerConfig.standardOAuthConfig.clientId,
            client_secret: providerConfig.standardOAuthConfig.clientSecret,
            facebook_config_id: providerConfig.standardOAuthConfig.facebookConfigId ?? undefined,
            microsoft_tenant_id: providerConfig.standardOAuthConfig.microsoftTenantId ?? undefined,
          } as const;
        } else {
          throw new StackAssertionError(`Exactly one of the provider configs should be set on provider config '${config.id}' of project '${prisma.id}'`, { prisma });
        }
      }
    })
    .filter((provider): provider is Exclude<typeof provider, undefined> => !!provider)
    .sort((a, b) => stringCompare(a.id, b.id));

  const passwordAuth = prisma.config.authMethodConfigs.find((config) => config.passwordConfig && config.enabled);
  const otpAuth = prisma.config.authMethodConfigs.find((config) => config.otpConfig && config.enabled);
  const passkeyAuth = prisma.config.authMethodConfigs.find((config) => config.passkeyConfig && config.enabled);

  return {
    id: prisma.id,
    display_name: prisma.displayName,
    description: prisma.description,
    created_at_millis: prisma.createdAt.getTime(),
    user_count: prisma._count.projectUsers,
    is_production_mode: prisma.isProductionMode,
    config: {
      id: prisma.config.id,
      allow_localhost: prisma.config.allowLocalhost,
      sign_up_enabled: prisma.config.signUpEnabled,
      credential_enabled: !!passwordAuth,
      magic_link_enabled: !!otpAuth,
      passkey_enabled: !!passkeyAuth,
      create_team_on_sign_up: prisma.config.createTeamOnSignUp,
      client_team_creation_enabled: prisma.config.clientTeamCreationEnabled,
      client_user_deletion_enabled: prisma.config.clientUserDeletionEnabled,
      domains: prisma.config.domains
        .sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((domain) => ({
          domain: domain.domain,
          handler_path: domain.handlerPath,
        })),
      oauth_providers: oauthProviders,
      enabled_oauth_providers: oauthProviders.filter(provider => provider.enabled),
      oauth_account_merge_strategy: typedToLowercase(prisma.config.oauthAccountMergeStrategy),
      email_config: (() => {
        const emailServiceConfig = prisma.config.emailServiceConfig;
        if (!emailServiceConfig) {
          throw new StackAssertionError(`Email service config should be set on project '${prisma.id}'`, { prisma });
        }
        if (emailServiceConfig.proxiedEmailServiceConfig) {
          return {
            type: "shared"
          } as const;
        } else if (emailServiceConfig.standardEmailServiceConfig) {
          const standardEmailConfig = emailServiceConfig.standardEmailServiceConfig;
          return {
            type: "standard",
            host: standardEmailConfig.host,
            port: standardEmailConfig.port,
            username: standardEmailConfig.username,
            password: standardEmailConfig.password,
            sender_email: standardEmailConfig.senderEmail,
            sender_name: standardEmailConfig.senderName,
          } as const;
        } else {
          throw new StackAssertionError(`Exactly one of the email service configs should be set on project '${prisma.id}'`, { prisma });
        }
      })(),
      team_creator_default_permissions: prisma.config.permissions.filter(perm => perm.isDefaultTeamCreatorPermission)
        .map(teamPermissionDefinitionJsonFromDbType)
        .concat(prisma.config.teamCreateDefaultSystemPermissions.map(db => teamPermissionDefinitionJsonFromTeamSystemDbType(db, prisma.config)))
        .sort((a, b) => stringCompare(a.id, b.id))
        .map(perm => ({ id: perm.id })),
      team_member_default_permissions: prisma.config.permissions.filter(perm => perm.isDefaultTeamMemberPermission)
        .map(teamPermissionDefinitionJsonFromDbType)
        .concat(prisma.config.teamMemberDefaultSystemPermissions.map(db => teamPermissionDefinitionJsonFromTeamSystemDbType(db, prisma.config)))
        .sort((a, b) => stringCompare(a.id, b.id))
        .map(perm => ({ id: perm.id })),
      user_default_permissions: prisma.config.permissions.filter(perm => perm.isDefaultProjectPermission)
        .map(teamPermissionDefinitionJsonFromDbType)
        .sort((a, b) => stringCompare(a.id, b.id))
        .map(perm => ({ id: perm.id })),
    }
  };
}

function isStringArray(value: any): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string");
}

export function listManagedProjectIds(projectUser: UsersCrud["Admin"]["Read"]) {
  const serverMetadata = projectUser.server_metadata;
  if (typeof serverMetadata !== "object") {
    throw new StackAssertionError("Invalid server metadata, did something go wrong?", { serverMetadata });
  }
  const managedProjectIds = (serverMetadata as any)?.managedProjectIds ?? [];
  if (!isStringArray(managedProjectIds)) {
    throw new StackAssertionError("Invalid server metadata, did something go wrong? Expected string array", { managedProjectIds });
  }

  return managedProjectIds;
}

export function getProjectQuery(projectId: string): RawQuery<ProjectsCrud["Admin"]["Read"] | null> {
  const OAuthProviderConfigSelectSql = Prisma.sql`
    (
      to_jsonb("OAuthProviderConfig") ||
      jsonb_build_object(
        'ProxiedOAuthConfig', (
          SELECT (
            to_jsonb("ProxiedOAuthProviderConfig") ||
            jsonb_build_object()
          )
          FROM "ProxiedOAuthProviderConfig"
          WHERE "ProxiedOAuthProviderConfig"."projectConfigId" = "OAuthProviderConfig"."projectConfigId" AND "ProxiedOAuthProviderConfig"."id" = "OAuthProviderConfig"."id"
        ),
        'StandardOAuthConfig', (
          SELECT (
            to_jsonb("StandardOAuthProviderConfig") ||
            jsonb_build_object()
          )
          FROM "StandardOAuthProviderConfig"
          WHERE "StandardOAuthProviderConfig"."projectConfigId" = "OAuthProviderConfig"."projectConfigId" AND "StandardOAuthProviderConfig"."id" = "OAuthProviderConfig"."id"
        )
      )
    )
  `;

  return {
    sql: Prisma.sql`
      SELECT to_json(
        (
          SELECT (
            to_jsonb("Project".*) ||
            jsonb_build_object(
              'ProjectConfig', (
                SELECT (
                  to_jsonb("ProjectConfig".*) ||
                  jsonb_build_object(
                    'OAuthProviderConfigs', (
                      SELECT COALESCE(ARRAY_AGG(
                        ${OAuthProviderConfigSelectSql}
                      ), '{}')
                      FROM "OAuthProviderConfig"
                      WHERE "OAuthProviderConfig"."projectConfigId" = "ProjectConfig"."id"
                    ),
                    'EmailServiceConfig', (
                      SELECT (
                        to_jsonb("EmailServiceConfig") ||
                        jsonb_build_object(
                          'ProxiedEmailServiceConfig', (
                            SELECT (
                              to_jsonb("ProxiedEmailServiceConfig") ||
                              jsonb_build_object()
                            )
                            FROM "ProxiedEmailServiceConfig"
                            WHERE "ProxiedEmailServiceConfig"."projectConfigId" = "EmailServiceConfig"."projectConfigId"
                          ),
                          'StandardEmailServiceConfig', (
                            SELECT (
                              to_jsonb("StandardEmailServiceConfig") ||
                              jsonb_build_object()
                            )
                            FROM "StandardEmailServiceConfig"
                            WHERE "StandardEmailServiceConfig"."projectConfigId" = "EmailServiceConfig"."projectConfigId"
                          )
                        )
                      )
                      FROM "EmailServiceConfig"
                      WHERE "EmailServiceConfig"."projectConfigId" = "ProjectConfig"."id"
                    ),
                    'Permissions', (
                      SELECT COALESCE(ARRAY_AGG(
                        to_jsonb("Permission") ||
                        jsonb_build_object(
                          'ParentEdges', (
                            SELECT COALESCE(ARRAY_AGG(
                              to_jsonb("PermissionEdge") ||
                              jsonb_build_object(
                                'ParentPermission', (
                                  SELECT (
                                    to_jsonb("Permission") ||
                                    jsonb_build_object()
                                  )
                                  FROM "Permission"
                                  WHERE "Permission"."projectConfigId" = "ProjectConfig"."id" AND "Permission"."dbId" = "PermissionEdge"."parentPermissionDbId"
                                )
                              )
                            ), '{}')
                            FROM "PermissionEdge"
                            WHERE "PermissionEdge"."childPermissionDbId" = "Permission"."dbId"
                          )
                        )
                      ), '{}')
                      FROM "Permission"
                      WHERE "Permission"."projectConfigId" = "ProjectConfig"."id"
                    ),
                    'AuthMethodConfigs', (
                      SELECT COALESCE(ARRAY_AGG(
                        to_jsonb("AuthMethodConfig") ||
                        jsonb_build_object(
                          'OAuthProviderConfig', (
                            SELECT ${OAuthProviderConfigSelectSql}
                            FROM "OAuthProviderConfig"
                            WHERE "OAuthProviderConfig"."projectConfigId" = "ProjectConfig"."id" AND "OAuthProviderConfig"."authMethodConfigId" = "AuthMethodConfig"."id"
                          ),
                          'OtpAuthMethodConfig', (
                            SELECT (
                              to_jsonb("OtpAuthMethodConfig") ||
                              jsonb_build_object()
                            )
                            FROM "OtpAuthMethodConfig"
                            WHERE "OtpAuthMethodConfig"."projectConfigId" = "ProjectConfig"."id" AND "OtpAuthMethodConfig"."authMethodConfigId" = "AuthMethodConfig"."id"
                          ),
                          'PasswordAuthMethodConfig', (
                            SELECT (
                              to_jsonb("PasswordAuthMethodConfig") ||
                              jsonb_build_object()
                            )
                            FROM "PasswordAuthMethodConfig"
                            WHERE "PasswordAuthMethodConfig"."projectConfigId" = "ProjectConfig"."id" AND "PasswordAuthMethodConfig"."authMethodConfigId" = "AuthMethodConfig"."id"
                          ),
                          'PasskeyAuthMethodConfig', (
                            SELECT (
                              to_jsonb("PasskeyAuthMethodConfig") ||
                              jsonb_build_object()
                            )
                            FROM "PasskeyAuthMethodConfig"
                            WHERE "PasskeyAuthMethodConfig"."projectConfigId" = "ProjectConfig"."id" AND "PasskeyAuthMethodConfig"."authMethodConfigId" = "AuthMethodConfig"."id"
                          )
                        )
                      ), '{}')
                      FROM "AuthMethodConfig"
                      WHERE "AuthMethodConfig"."projectConfigId" = "ProjectConfig"."id"
                    ),
                    'ConnectedAccountConfigs', (
                      SELECT COALESCE(ARRAY_AGG(
                        to_jsonb("ConnectedAccountConfig") ||
                        jsonb_build_object(
                          'OAuthProviderConfig', (
                            SELECT ${OAuthProviderConfigSelectSql}
                            FROM "OAuthProviderConfig"
                            WHERE "OAuthProviderConfig"."projectConfigId" = "ProjectConfig"."id" AND "OAuthProviderConfig"."connectedAccountConfigId" = "ConnectedAccountConfig"."id"
                          )
                        )
                      ), '{}')
                      FROM "ConnectedAccountConfig"
                      WHERE "ConnectedAccountConfig"."projectConfigId" = "ProjectConfig"."id"
                    ),
                    'Domains', (
                      SELECT COALESCE(ARRAY_AGG(
                        to_jsonb("ProjectDomain") ||
                        jsonb_build_object()
                      ), '{}')
                      FROM "ProjectDomain"
                      WHERE "ProjectDomain"."projectConfigId" = "ProjectConfig"."id"
                    )
                  )
                )
                FROM "ProjectConfig"
                WHERE "ProjectConfig"."id" = "Project"."configId"
              )
            )
          )
          FROM "Project"
          WHERE "Project"."id" = ${projectId}
        )
      ) AS "row_data_json"
    `,
    postProcess: (queryResult) => {
      if (queryResult.length !== 1) {
        throw new StackAssertionError(`Expected 1 project with id ${projectId}, got ${queryResult.length}`, { queryResult });
      }

      const row = queryResult[0].row_data_json;
      if (!row) {
        return null;
      }

      const teamPermissions = [
        ...row.ProjectConfig.Permissions.map((perm: any) => teamPermissionDefinitionJsonFromRawDbType(perm)),
        ...Object.values(TeamSystemPermission).map(systemPermission => teamPermissionDefinitionJsonFromTeamSystemDbType(systemPermission, row.ProjectConfig)),
      ].sort((a, b) => stringCompare(a.id, b.id));

      const oauthProviderAuthMethods = row.ProjectConfig.AuthMethodConfigs
        .map((authMethodConfig: any) => {
          if (authMethodConfig.OAuthProviderConfig) {
            const providerConfig = authMethodConfig.OAuthProviderConfig;
            if (providerConfig.ProxiedOAuthConfig) {
              return {
                id: typedToLowercase(providerConfig.ProxiedOAuthConfig.type),
                enabled: authMethodConfig.enabled,
                type: "shared",
              } as const;
            } else if (providerConfig.StandardOAuthConfig) {
              return {
                id: typedToLowercase(providerConfig.StandardOAuthConfig.type),
                enabled: authMethodConfig.enabled,
                type: "standard",
                client_id: providerConfig.StandardOAuthConfig.clientId,
                client_secret: providerConfig.StandardOAuthConfig.clientSecret,
                facebook_config_id: providerConfig.StandardOAuthConfig.facebookConfigId ?? undefined,
                microsoft_tenant_id: providerConfig.StandardOAuthConfig.microsoftTenantId ?? undefined,
              } as const;
            } else {
              throw new StackAssertionError(`Exactly one of the OAuth provider configs should be set on auth method config ${authMethodConfig.id} of project ${row.id}`, { row });
            }
          }
        })
        .filter(isNotNull)
        .sort((a: any, b: any) => stringCompare(a.id, b.id));

      return {
        id: row.id,
        display_name: row.displayName,
        description: row.description,
        created_at_millis: new Date(row.createdAt + "Z").getTime(),
        user_count: row.userCount,
        is_production_mode: row.isProductionMode,
        config: {
          id: row.ProjectConfig.id,
          allow_localhost: row.ProjectConfig.allowLocalhost,
          sign_up_enabled: row.ProjectConfig.signUpEnabled,
          credential_enabled: row.ProjectConfig.AuthMethodConfigs.some((config: any) => config.PasswordAuthMethodConfig && config.enabled),
          magic_link_enabled: row.ProjectConfig.AuthMethodConfigs.some((config: any) => config.OtpAuthMethodConfig && config.enabled),
          passkey_enabled: row.ProjectConfig.AuthMethodConfigs.some((config: any) => config.PasskeyAuthMethodConfig && config.enabled),
          create_team_on_sign_up: row.ProjectConfig.createTeamOnSignUp,
          client_team_creation_enabled: row.ProjectConfig.clientTeamCreationEnabled,
          client_user_deletion_enabled: row.ProjectConfig.clientUserDeletionEnabled,
          domains: row.ProjectConfig.Domains
            .sort((a: any, b: any) => new Date(a.createdAt + "Z").getTime() - new Date(b.createdAt + "Z").getTime())
            .map((domain: any) => ({
              domain: domain.domain,
              handler_path: domain.handlerPath,
            })),
          oauth_providers: oauthProviderAuthMethods,
          enabled_oauth_providers: oauthProviderAuthMethods.filter((provider: any) => provider.enabled),
          oauth_account_merge_strategy: typedToLowercase(row.ProjectConfig.oauthAccountMergeStrategy) as "link_method" | "raise_error" | "allow_duplicates",
          email_config: (() => {
            const emailServiceConfig = row.ProjectConfig.EmailServiceConfig;
            if (!emailServiceConfig) {
              throw new StackAssertionError(`Email service config should be set on project ${row.id}`, { row });
            }
            if (emailServiceConfig.ProxiedEmailServiceConfig) {
              return {
                type: "shared"
              } as const;
            } else if (emailServiceConfig.StandardEmailServiceConfig) {
              const standardEmailConfig = emailServiceConfig.StandardEmailServiceConfig;
              return {
                type: "standard",
                host: standardEmailConfig.host,
                port: standardEmailConfig.port,
                username: standardEmailConfig.username,
                password: standardEmailConfig.password,
                sender_email: standardEmailConfig.senderEmail,
                sender_name: standardEmailConfig.senderName,
              } as const;
            } else {
              throw new StackAssertionError(`Exactly one of the email service configs should be set on project ${row.id}`, { row });
            }
          })(),
          team_creator_default_permissions: teamPermissions
            .filter(perm => perm.__is_default_team_creator_permission)
            .map(perm => ({ id: perm.id })),
          team_member_default_permissions: teamPermissions
            .filter(perm => perm.__is_default_team_member_permission)
            .map(perm => ({ id: perm.id })),
          user_default_permissions: teamPermissions
            .filter(perm => perm.__is_default_project_permission)
            .map(perm => ({ id: perm.id })),
        },
      };
    },
  } as const;
}

export async function getProject(projectId: string): Promise<ProjectsCrud["Admin"]["Read"] | null> {
  const result = await rawQuery(getProjectQuery(projectId));

  // In non-prod environments, let's also call the legacy function and ensure the result is the same
  if (!getNodeEnvironment().includes("prod")) {
    const legacyResult = await getProjectLegacy(projectId);
    if (!deepPlainEquals(omit(result ?? {}, ["user_count"] as any), omit(legacyResult ?? {}, ["user_count"] as any))) {
      throw new StackAssertionError("Project result mismatch", {
        result,
        legacyResult,
      });
    }
  }

  return result;
}

async function getProjectLegacy(projectId: string): Promise<ProjectsCrud["Admin"]["Read"] | null> {
  const rawProject = await prismaClient.project.findUnique({
    where: { id: projectId },
    include: fullProjectInclude,
  });

  if (!rawProject) {
    return null;
  }

  return projectPrismaToCrud(rawProject);
}

export async function createProject(ownerIds: string[], data: InternalProjectsCrud["Admin"]["Create"]) {
  const result = await retryTransaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        id: generateUuid(),
        displayName: data.display_name,
        description: data.description ?? "",
        isProductionMode: data.is_production_mode ?? false,
        config: {
          create: {
            signUpEnabled: data.config?.sign_up_enabled,
            allowLocalhost: data.config?.allow_localhost ?? true,
            createTeamOnSignUp: data.config?.create_team_on_sign_up ?? false,
            clientTeamCreationEnabled: data.config?.client_team_creation_enabled ?? false,
            clientUserDeletionEnabled: data.config?.client_user_deletion_enabled ?? false,
            oauthAccountMergeStrategy: data.config?.oauth_account_merge_strategy ? typedToUppercase(data.config.oauth_account_merge_strategy): 'LINK_METHOD',
            domains: data.config?.domains ? {
              create: data.config.domains.map(item => ({
                domain: item.domain,
                handlerPath: item.handler_path,
              }))
            } : undefined,
            oauthProviderConfigs: data.config?.oauth_providers ? {
              create: data.config.oauth_providers.map(item => ({
                id: item.id,
                proxiedOAuthConfig: item.type === "shared" ? {
                  create: {
                    type: typedToUppercase(ensureSharedProvider(item.id)),
                  }
                } : undefined,
                standardOAuthConfig: item.type === "standard" ? {
                  create: {
                    type: typedToUppercase(ensureStandardProvider(item.id)),
                    clientId: item.client_id ?? throwErr('client_id is required'),
                    clientSecret: item.client_secret ?? throwErr('client_secret is required'),
                    facebookConfigId: item.facebook_config_id,
                    microsoftTenantId: item.microsoft_tenant_id,
                  }
                } : undefined,
              }))
            } : undefined,
            emailServiceConfig: data.config?.email_config ? {
              create: {
                proxiedEmailServiceConfig: data.config.email_config.type === "shared" ? {
                  create: {}
                } : undefined,
                standardEmailServiceConfig: data.config.email_config.type === "standard" ? {
                  create: {
                    host: data.config.email_config.host ?? throwErr('host is required'),
                    port: data.config.email_config.port ?? throwErr('port is required'),
                    username: data.config.email_config.username ?? throwErr('username is required'),
                    password: data.config.email_config.password ?? throwErr('password is required'),
                    senderEmail: data.config.email_config.sender_email ?? throwErr('sender_email is required'),
                    senderName: data.config.email_config.sender_name ?? throwErr('sender_name is required'),
                  }
                } : undefined,
              }
            } : {
              create: {
                proxiedEmailServiceConfig: {
                  create: {}
                },
              },
            },
          },
        }
      },
      include: fullProjectInclude,
    });

    const tenancy = await tx.tenancy.create({
      data: {
        projectId: project.id,
        branchId: "main",
        organizationId: null,
        hasNoOrganization: "TRUE",
      },
    });

    // all oauth providers are created as auth methods for backwards compatibility
    await tx.projectConfig.update({
      where: {
        id: project.config.id,
      },
      data: {
        authMethodConfigs: {
          create: [
            ...data.config?.oauth_providers ? project.config.oauthProviderConfigs.map(item => ({
              enabled: (data.config?.oauth_providers?.find(p => p.id === item.id) ?? throwErr("oauth provider not found")).enabled,
              oauthProviderConfig: {
                connect: {
                  projectConfigId_id: {
                    projectConfigId: project.config.id,
                    id: item.id,
                  }
                }
              }
            })) : [],
            ...data.config?.magic_link_enabled ? [{
              enabled: true,
              otpConfig: {
                create: {
                  contactChannelType: 'EMAIL',
                }
              },
            }] : [],
            ...(data.config?.credential_enabled ?? true) ? [{
              enabled: true,
              passwordConfig: {
                create: {}
              },
            }] : [],
            ...data.config?.passkey_enabled ? [{
              enabled: true,
              passkeyConfig: {
                create: {}
              },
            }] : [],
          ]
        }
      }
    });

    // all standard oauth providers are created as connected accounts for backwards compatibility
    await tx.projectConfig.update({
      where: {
        id: project.config.id,
      },
      data: {
        connectedAccountConfigs: data.config?.oauth_providers ? {
          create: project.config.oauthProviderConfigs.map(item => ({
            enabled: (data.config?.oauth_providers?.find(p => p.id === item.id) ?? throwErr("oauth provider not found")).enabled,
            oauthProviderConfig: {
              connect: {
                projectConfigId_id: {
                  projectConfigId: project.config.id,
                  id: item.id,
                }
              }
            }
          })),
        } : undefined,
      }
    });

    await tx.permission.create({
      data: {
        tenancyId: tenancy.id,
        projectConfigId: project.config.id,
        queryableId: "member",
        description: "Default permission for team members",
        scope: 'TEAM',
        parentEdges: {
          createMany: {
            data: (['READ_MEMBERS', 'INVITE_MEMBERS'] as const).map(p => ({ parentTeamSystemPermission: p })),
          },
        },
        isDefaultTeamMemberPermission: true,
      },
    });

    await tx.permission.create({
      data: {
        tenancyId: tenancy.id,
        projectConfigId: project.config.id,
        queryableId: "admin",
        description: "Default permission for team creators",
        scope: 'TEAM',
        parentEdges: {
          createMany: {
            data: (['UPDATE_TEAM', 'DELETE_TEAM', 'READ_MEMBERS', 'REMOVE_MEMBERS', 'INVITE_MEMBERS'] as const).map(p =>({ parentTeamSystemPermission: p }))
          },
        },
        isDefaultTeamCreatorPermission: true,
      },
    });

    // Update owner metadata
    for (const userId of ownerIds) {
      const projectUserTx = await tx.projectUser.findUnique({
        where: {
          mirroredProjectId_mirroredBranchId_projectUserId: {
            mirroredProjectId: "internal",
            mirroredBranchId: "main",
            projectUserId: userId,
          },
        },
      });
      if (!projectUserTx) {
        captureError("project-creation-owner-not-found", new StackAssertionError(`Attempted to create project, but owner user ID ${userId} not found. Did they delete their account? Continuing silently, but if the user is coming from an owner pack you should probably update it.`, { ownerIds }));
        continue;
      }

      const serverMetadataTx: any = projectUserTx.serverMetadata ?? {};

      await tx.projectUser.update({
        where: {
          mirroredProjectId_mirroredBranchId_projectUserId: {
            mirroredProjectId: "internal",
            mirroredBranchId: "main",
            projectUserId: projectUserTx.projectUserId,
          },
        },
        data: {
          serverMetadata: {
            ...serverMetadataTx ?? {},
            managedProjectIds: [
              ...serverMetadataTx?.managedProjectIds ?? [],
              project.id,
            ],
          },
        },
      });
    }

    const result = await tx.project.findUnique({
      where: { id: project.id },
      include: fullProjectInclude,
    });

    if (!result) {
      throw new StackAssertionError(`Project with id '${project.id}' not found after creation`, { project });
    }
    return result;
  });

  return projectPrismaToCrud(result);
}
