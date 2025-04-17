import { Prisma } from "@prisma/client";
import { AdminUserProjectsCrud, ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { StackAssertionError, captureError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { RawQuery, rawQuery, retryTransaction } from "../prisma-client";
import { getRenderedOrganizationConfigQuery, renderedOrganizationConfigToProjectCrud } from "./config";
import { ensureSharedProvider, ensureStandardProvider } from "./request-checks";

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

export function getProjectQuery(projectId: string): RawQuery<Promise<ProjectsCrud["Admin"]["Read"] | null>> {
  return RawQuery.then(
    RawQuery.all([
      {
        sql: Prisma.sql`
          SELECT "Project".*
          FROM "Project"
          WHERE "Project"."id" = ${projectId}
        `,
        postProcess: (queryResult) => {
          if (queryResult.length > 1) {
            throw new StackAssertionError(`Expected 0 or 1 projects with id ${projectId}, got ${queryResult.length}`, { queryResult });
          }
          if (queryResult.length === 0) {
            return null;
          }
          const row = queryResult[0];
          return {
            id: row.id,
            display_name: row.displayName,
            description: row.description,
            created_at_millis: new Date(row.createdAt + "Z").getTime(),
            user_count: row.userCount,
            is_production_mode: row.isProductionMode,
          };
        },
      } as const,
      getRenderedOrganizationConfigQuery({ projectId, branchId: "main", organizationId: null }),
    ] as const),
    async (result) => {
      const projectPart = result[0];
      if (!projectPart) {
        return null;
      }
      const renderedConfig = await result[1];

      return {
        ...projectPart,
        config: renderedOrganizationConfigToProjectCrud(renderedConfig),
      };
    }
  );
}

export async function getProject(projectId: string): Promise<ProjectsCrud["Admin"]["Read"] | null> {
  const result = await rawQuery(getProjectQuery(projectId));
  return result;
}

export async function createOrUpdateProject(
  options: {
    ownerIds: string[],
  } & ({
    type: "create",
    data: AdminUserProjectsCrud["Admin"]["Create"],
  } | {
    type: "update",
    projectId: string,
    data: ProjectsCrud["Admin"]["Update"],
  })
) {
  const projectId = await retryTransaction(async (tx) => {
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
            allowUserApiKeys: data.config?.allow_user_api_keys ?? false,
            allowTeamApiKeys: data.config?.allow_team_api_keys ?? false,
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
            data: (['UPDATE_TEAM', 'DELETE_TEAM', 'READ_MEMBERS', 'REMOVE_MEMBERS', 'INVITE_MEMBERS', 'MANAGE_API_KEYS'] as const).map(p =>({ parentTeamSystemPermission: p }))
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

    return project.id;
  });

  return await getProject(projectId);
}
