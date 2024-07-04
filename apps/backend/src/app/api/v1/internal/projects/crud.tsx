import { createPrismaCrudHandlers } from "@/route-handlers/prisma-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { StatusError, throwIfUndefined } from "@stackframe/stack-shared/dist/utils/errors";
import { internalProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { prismaClient } from "@/prisma-client";
import { typedToLowercase, typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { Prisma, ProxiedOAuthProviderType } from "@prisma/client";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import {
  serverPermissionDefinitionJsonFromDbType,
  serverPermissionDefinitionJsonFromTeamSystemDbType,
} from "@/lib/permissions";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";

function listProjectIds(projectUser: UsersCrud["Server"]["Read"]) {
  const serverMetadata = projectUser.server_metadata;
  if (typeof serverMetadata !== "object" || !(!serverMetadata || "managedProjectIds" in serverMetadata)) {
    throw new StackAssertionError("Invalid server metadata, did something go wrong?", { serverMetadata });
  }
  const managedProjectIds = serverMetadata?.managedProjectIds ?? [];
  if (!Array.isArray(managedProjectIds) || !managedProjectIds.every((id) => typeof id === "string")) {
    throw new StackAssertionError("Invalid server metadata, did something go wrong? Expected string array", { managedProjectIds });
  }

  return managedProjectIds;
}

export const internalProjectsCrudHandlers = createPrismaCrudHandlers(internalProjectsCrud, "project", {
  paramsSchema: yupObject({
    projectId: yupString().required(),
  }),
  onPrepare: async ({ auth }) => {
    if (!auth.user) {
      throw new KnownErrors.UserAuthenticationRequired();
    }
    if (auth.user.project_id !== 'internal') {
      throw new KnownErrors.ExpectedInternalProject();
    }
  },
  baseFields: async ({ params }) => ({
    id: params.projectId,
  }),
  where: async ({ auth }) => {
    const managedProjectIds = listProjectIds(throwIfUndefined(auth.user, "auth.user"));
    
    return {
      id: { in: managedProjectIds },
    };
  },
  whereUnique: async ({ auth, params }) => {
    const managedProjectIds = listProjectIds(throwIfUndefined(auth.user, "auth.user"));
    
    return {
      id: params.projectId,
      AND: [
        { id: { in: managedProjectIds } },
      ],
    };
  },
  include: async () => ({
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
          include: {
            parentEdges: {
              include: {
                parentPermission: true,
              },
            },
          }
        },
        domains: true,
      },
    },
    _count: {
      select: {
        users: true,
      },
    },
  }),
  notFoundError: () => new KnownErrors.ProjectNotFound(),
  crudToPrisma: async (crud, { auth, params, type }) => {
    // ======================= create =======================

    if (type === 'create') {
      return {
        id: generateUuid(),
        displayName: throwIfUndefined(crud.display_name, "display_name"),
        description: crud.description,
        isProductionMode: crud.is_production_mode || false,
        config: {
          create: {
            credentialEnabled: crud.config?.credential_enabled || true,
            magicLinkEnabled: crud.config?.magic_link_enabled || false,
            allowLocalhost: crud.config?.allow_localhost || true,
            createTeamOnSignUp: crud.config?.create_team_on_sign_up || false,
            domains: crud.config?.domains ? {
              create: crud.config.domains.map(item => ({
                domain: item.domain,
                handlerPath: item.handler_path,
              }))
            } : undefined,
            oauthProviderConfigs: crud.config?.oauth_providers ? {
              create: crud.config.oauth_providers.map(item => ({
                id: item.id,
                enabled: item.enabled,
                proxiedOAuthConfig: item.type === "shared" ? {
                  create: {
                    type: typedToUppercase(item.id),
                  }
                } : undefined,
                standardOAuthConfig: item.type === "standard" ? {
                  create: {
                    type: typedToUppercase(item.id),
                    clientId: throwIfUndefined(item.client_id, "client_id"),
                    clientSecret: throwIfUndefined(item.client_secret, "client_secret"),
                  }
                } : undefined,
              }))
            } : undefined,
            emailServiceConfig: crud.config?.email_config ? {
              create: {
                proxiedEmailServiceConfig: crud.config.email_config.type === "shared" ? {
                  create: {}
                } : undefined,
                standardEmailServiceConfig: crud.config.email_config.type === "standard" ? {
                  create: {
                    host: throwIfUndefined(crud.config.email_config.host, "host"),
                    port: throwIfUndefined(crud.config.email_config.port, "port"),
                    username: throwIfUndefined(crud.config.email_config.username, "username"),
                    password: throwIfUndefined(crud.config.email_config.password, "password"),
                    senderEmail: throwIfUndefined(crud.config.email_config.sender_email, "sender_email"),
                    senderName: throwIfUndefined(crud.config.email_config.sender_name, "sender_name"),
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
      } satisfies Prisma.ProjectCreateInput;
    }

    // ======================= get the old project =======================
    const oldProject = await prismaClient.project.findUnique({
      where: {
        id: params.projectId,
      },
      include: {
        config: {
          include: {
            emailServiceConfig: {
              include: {
                proxiedEmailServiceConfig: true,
                standardEmailServiceConfig: true,
              },
            },
            domains: true,
            oauthProviderConfigs: {
              include: {
                proxiedOAuthConfig: true,
                standardOAuthConfig: true,
              },
            },
          }
        }
      },
    });

    // the project does not exist, the update operation is invalid
    if (!oldProject) {
      return {};
    }

    // ======================= update email config =======================
    // update the corresponding config type if it is already defined
    // delete the other config type
    // create the config type if it is not defined

    const emailConfig = crud.config?.email_config;
    if (emailConfig) {
      let updateData = {};

      await prismaClient.standardEmailServiceConfig.deleteMany({
        where: { projectConfigId: oldProject.config.id },
      });
      await prismaClient.proxiedEmailServiceConfig.deleteMany({
        where: { projectConfigId: oldProject.config.id },
      });


      if (emailConfig.type === 'standard') {
        updateData = {
          standardEmailServiceConfig: {
            create: {
              host: throwIfUndefined(emailConfig.host, "host"),
              port: throwIfUndefined(emailConfig.port, "port"),
              username: throwIfUndefined(emailConfig.username, "username"),
              password: throwIfUndefined(emailConfig.password, "password"),
              senderEmail: throwIfUndefined(emailConfig.sender_email, "sender_email"),
              senderName: throwIfUndefined(emailConfig.sender_name, "sender_name"),
            },
          },
        };
      } else {
        updateData = {
          proxiedEmailServiceConfig: {
            create: {},
          },
        };
      }

      await prismaClient.emailServiceConfig.update({
        where: { projectConfigId: oldProject.config.id },
        data: updateData,
      });
    }
    
    // ======================= update oauth config =======================
    // loop though all the items from crud.config.oauth_providers
    // create the config if it is not already in the DB
    // update the config if it is already in the DB
    // set the enabled flag to false if it is not in the crud.config.oauth_providers but is in the DB

    const oldProviders = oldProject.config.oauthProviderConfigs;
    const oauthProviderUpdates = crud.config?.oauth_providers;
    if (oauthProviderUpdates) {
      const providerMap = new Map(oldProviders.map((provider) => [
        provider.id, 
        {
          providerUpdate: (() => {
            const update = oauthProviderUpdates.find((p) => p.id === provider.id);
            if (!update) {
              throw new StatusError(StatusError.BadRequest, `Provider with id '${provider.id}' not found in the update`);
            }
            return update;
          })(),
          oldProvider: provider,
        }
      ]));

      const newProviders =  oauthProviderUpdates.map((providerUpdate) => ({
        id: providerUpdate.id, 
        update: providerUpdate
      })).filter(({ id }) => !providerMap.has(id));

      // Update existing proxied/standard providers
      for (const [id, { providerUpdate, oldProvider }] of providerMap) {
        // remove existing provider configs
        if (oldProvider.proxiedOAuthConfig) {
          await prismaClient.proxiedOAuthProviderConfig.deleteMany({
            where: { projectConfigId: oldProject.config.id, id: providerUpdate.id },
          });
        }
        if (oldProvider.standardOAuthConfig) {
          await prismaClient.standardOAuthProviderConfig.deleteMany({
            where: { projectConfigId: oldProject.config.id, id: providerUpdate.id },
          });
        }
    
        // update provider configs with newly created proxied/standard provider configs
        let providerConfigUpdate;
        if (providerUpdate.type === 'shared') {
          providerConfigUpdate = {
            proxiedOAuthConfig: {
              create: {
                type: typedToUppercase(providerUpdate.id),
              },
            },
          };
    
        } else {
          providerConfigUpdate = {
            standardOAuthConfig: {
              create: {
                type: typedToUppercase(providerUpdate.id),
                clientId: throwIfUndefined(providerUpdate.client_id, "client_id"),
                clientSecret: throwIfUndefined(providerUpdate.client_secret, "client_secret"),
              },
            },
          };
        }
    
        await prismaClient.oAuthProviderConfig.update({
          where: { projectConfigId_id: { projectConfigId: oldProject.config.id, id } },
          data: {
            enabled: providerUpdate.enabled,
            ...providerConfigUpdate,
          },
        });
      }

      // Create new providers
      for (const provider of newProviders) {
        let providerConfigData;
        if (provider.update.type === 'shared') {
          providerConfigData = {
            proxiedOAuthConfig: {
              create: {
                type: typedToUppercase(provider.update.id),
              },
            },
          };
        } else {
          providerConfigData = {
            standardOAuthConfig: {
              create: {
                type: typedToUppercase(provider.update.id),
                clientId: throwIfUndefined(provider.update.client_id, "client_id"),
                clientSecret: throwIfUndefined(provider.update.client_secret, "client_secret"),
              },
            },
          };
        }

        await prismaClient.oAuthProviderConfig.create({
          data: {
            id: provider.id,
            projectConfigId: oldProject.config.id,
            enabled: provider.update.enabled,
            ...providerConfigData,
          },
        });
      }
    }

    // ======================= update the rest =======================

    return {
      displayName: crud.display_name,
      description: crud.description,
      isProductionMode: crud.is_production_mode,
      config: {
        update: {
          credentialEnabled: crud.config?.credential_enabled,
          magicLinkEnabled: crud.config?.magic_link_enabled,
          allowLocalhost: crud.config?.allow_localhost,
          createTeamOnSignUp: crud.config?.create_team_on_sign_up,
          domains: crud.config?.domains ? {
            deleteMany: {},
            create: crud.config.domains.map(item => ({
              domain: item.domain,
              handlerPath: item.handler_path,
            })),
          } : undefined
        },
      },
    } satisfies Prisma.ProjectUpdateInput;
  },
  onCreate: async (prisma, { auth }) => {
    const user = throwIfUndefined(auth.user, 'auth.user');
    const serverMetadataTx: any = user.server_metadata ?? {};
    await prismaClient.projectUser.update({
      where: {
        projectId_projectUserId: {
          projectId: auth.project.id,
          projectUserId: user.id,
        }
      },
      data: {
        serverMetadata: {
          ...(serverMetadataTx ?? {}),
          managedProjectIds: [
            ...(serverMetadataTx?.managedProjectIds ?? []),
            prisma.id,
          ],
        },
      },
    });
  },
  prismaToCrud: async (prisma, { auth }) => {
    return {
      id: prisma.id,
      display_name: prisma.displayName,
      description: prisma.description ?? undefined,
      created_at_millis: prisma.createdAt.getTime(),
      user_count: prisma._count.users,
      is_production_mode: prisma.isProductionMode,
      config: {
        id: prisma.config.id,
        allow_localhost: prisma.config.allowLocalhost,
        credential_enabled: prisma.config.credentialEnabled,
        magic_link_enabled: prisma.config.magicLinkEnabled,
        create_team_on_sign_up: prisma.config.createTeamOnSignUp,
        domains: prisma.config.domains.map((domain) => ({
          domain: domain.domain,
          handler_path: domain.handlerPath,
        })).sort((a, b) => a.domain.localeCompare(b.domain)),
        oauth_providers: prisma.config.oauthProviderConfigs.flatMap((provider): { 
          id: Lowercase<ProxiedOAuthProviderType>, 
          enabled: boolean, 
          type: 'standard' | 'shared', 
          client_id?: string | undefined, 
          client_secret?: string ,
        }[] => {
          if (provider.proxiedOAuthConfig) {
            return [{
              id: typedToLowercase(provider.proxiedOAuthConfig.type),
              enabled: provider.enabled,
              type: 'shared',
            }];
          } else if (provider.standardOAuthConfig) {
            return [{
              id: typedToLowercase(provider.standardOAuthConfig.type),
              enabled: provider.enabled,
              type: 'standard',
              client_id: provider.standardOAuthConfig.clientId,
              client_secret: provider.standardOAuthConfig.clientSecret,
            }];
          } else {
            throw new StackAssertionError(`Exactly one of the provider configs should be set on provider config '${provider.id}' of project '${prisma.id}'`, { prisma });
          }
        }).sort((a, b) => a.id.localeCompare(b.id)),
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
        teamCreatorDefaultPermissions: prisma.config.permissions.filter(perm => perm.isDefaultTeamCreatorPermission)
          .map(serverPermissionDefinitionJsonFromDbType)
          .concat(prisma.config.teamCreateDefaultSystemPermissions.map(serverPermissionDefinitionJsonFromTeamSystemDbType))
          .sort((a, b) => a.id.localeCompare(b.id)),
        teamMemberDefaultPermissions: prisma.config.permissions.filter(perm => perm.isDefaultTeamMemberPermission)
          .map(serverPermissionDefinitionJsonFromDbType)
          .concat(prisma.config.teamMemberDefaultSystemPermissions.map(serverPermissionDefinitionJsonFromTeamSystemDbType))
          .sort((a, b) => a.id.localeCompare(b.id)),
      }
    };
  },
});
