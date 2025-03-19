import { RawQuery, prismaClient, rawQuery, retryTransaction } from "@/prisma-client";
import { Prisma } from "@prisma/client";
import { mergeConfigs } from "@stackframe/stack-shared/dist/config/parser";
import { configSchema } from "@stackframe/stack-shared/dist/config/schema";
import { InternalProjectsCrud, ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, captureError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { deepPlainEquals, omit } from "@stackframe/stack-shared/dist/utils/objects";
import { stringCompare, typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { defaultConfig } from "next/dist/server/config-shared";
import { ensureSharedProvider, ensureStandardProvider } from "./request-checks";

export const fullProjectInclude = {
  _count: {
    select: {
      projectUsers: true,
    },
  },
} as const satisfies Prisma.ProjectInclude;

export async function projectPrismaToCrud(
  prisma: Prisma.ProjectGetPayload<{ include: typeof fullProjectInclude }>
): Promise<ProjectsCrud["Admin"]["Read"]> {
  const mergedConfig = await mergeConfigs({
    configSchema: configSchema,
    overrideConfigs: [
      { level: 'default', config: defaultConfig },
      { level: 'project', config: prisma.configOverride as any }
    ]
  });

  const oauthProviders = Object.entries(mergedConfig.authMethods)
    .filter(([_, method]) => method.type === 'oauth')
    .map(([_, method]) => {
      // Type assertion since we filtered for oauth type
      const oauthMethod = method as { type: 'oauth', id: string, oauthProviderId: string };
      const providerConfig = mergedConfig.oauthProviders[oauthMethod.oauthProviderId];

      if (providerConfig.isShared) {
        return {
          id: providerConfig.type,
          enabled: method.enabled,
          type: "shared",
        } as const;
      } else {
        return {
          id: providerConfig.type,
          enabled: method.enabled,
          type: "standard",
          client_id: providerConfig.clientId,
          client_secret: providerConfig.clientSecret,
          facebook_config_id: providerConfig.facebookConfigId,
          microsoft_tenant_id: providerConfig.microsoftTenantId,
        } as const;
      }
    })
    .sort((a, b) => stringCompare(a.id, b.id));

  const passwordAuth = Object.values(mergedConfig.authMethods)
    .find(method => method.type === 'password');

  const otpAuth = Object.values(mergedConfig.authMethods)
    .find(method => method.type === 'otp');

  const passkeyAuth = Object.values(mergedConfig.authMethods)
    .find(method => method.type === 'passkey');

  return {
    id: prisma.id,
    display_name: prisma.displayName,
    description: prisma.description,
    created_at_millis: prisma.createdAt.getTime(),
    user_count: prisma._count.projectUsers,
    is_production_mode: prisma.isProductionMode,
    config: {
      id: 'none',
      allow_localhost: mergedConfig.allowLocalhost,
      sign_up_enabled: mergedConfig.signUpEnabled,
      credential_enabled: !!passwordAuth,
      magic_link_enabled: !!otpAuth,
      passkey_enabled: !!passkeyAuth,
      create_team_on_sign_up: mergedConfig.createTeamOnSignUp,
      client_team_creation_enabled: mergedConfig.clientTeamCreationEnabled,
      client_user_deletion_enabled: mergedConfig.clientUserDeletionEnabled,
      domains: Object.entries(mergedConfig.domains)
        .map(([_, domain]) => ({
          domain: domain.domain,
          handler_path: domain.handlerPath,
        }))
        .sort((a, b) => stringCompare(a.domain, b.domain)),
      oauth_providers: oauthProviders,
      enabled_oauth_providers: oauthProviders.filter(provider => provider.enabled),
      oauth_account_merge_strategy: mergedConfig.oauthAccountMergeStrategy,
      email_config: (() => {
        const emailConfig = mergedConfig.emailConfig;
        if (emailConfig.isShared) {
          return {
            type: "shared"
          } as const;
        } else {
          return {
            type: "standard",
            host: emailConfig.host,
            port: emailConfig.port,
            username: emailConfig.username,
            password: emailConfig.password,
            sender_email: emailConfig.senderEmail,
            sender_name: emailConfig.senderName,
          } as const;
        }
      })(),
      team_creator_default_permissions: Object.entries(mergedConfig.teamCreateDefaultSystemPermissions)
        .map(([id, _]) => ({ id }))
        .sort((a, b) => stringCompare(a.id, b.id)),
      team_member_default_permissions: Object.entries(mergedConfig.teamMemberDefaultSystemPermissions)
        .map(([id, _]) => ({ id }))
        .sort((a, b) => stringCompare(a.id, b.id)),
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

export function getProjectQuery(projectId: string): RawQuery<ProjectsCrud["Admin"]["Read"]> {
  return {
    sql: Prisma.sql`
      SELECT to_json(
        (
          SELECT (
            to_jsonb("Project".*) ||
            jsonb_build_object(
              'config', (
                SELECT (
                  "Project"."configOverride"::jsonb ||
                  jsonb_build_object(
                    'domains', (
                      SELECT COALESCE(jsonb_object_agg(
                        key,
                        value
                      ), '{}')
                      FROM jsonb_each("Project"."configOverride"->'domains')
                    ),
                    'oauth_providers', (
                      SELECT COALESCE(jsonb_object_agg(
                        key,
                        value
                      ), '{}')
                      FROM jsonb_each("Project"."configOverride"->'oauthProviders')
                    ),
                    'auth_methods', (
                      SELECT COALESCE(jsonb_object_agg(
                        key,
                        value
                      ), '{}')
                      FROM jsonb_each("Project"."configOverride"->'authMethods')
                    )
                  )
                )
              )
            )
          )
          FROM "Project"
          WHERE "Project"."id" = ${projectId}
        )
      ) AS "row_data_json"
    `,
    postProcess: (rows) => rows[0]?.row_data_json ?? null
  };
}

export async function getProject(projectId: string): Promise<ProjectsCrud["Admin"]["Read"] | null> {
  const result = await rawQuery(getProjectQuery(projectId));

  // In non-prod environments, let's also call the legacy function and ensure the result is the same
  if (!getNodeEnvironment().includes("prod")) {
    const legacyResult = await getProjectLegacy(projectId);
    if (!deepPlainEquals(omit(result, ["user_count"] as any), omit(legacyResult ?? {}, ["user_count"] as any))) {
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

  return await projectPrismaToCrud(rawProject);
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

  return await projectPrismaToCrud(result);
}
