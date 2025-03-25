import { isTeamSystemPermission, listPermissionDefinitions, teamSystemPermissionStringToDBType } from "@/lib/permissions";
import { fullProjectInclude, projectPrismaToCrud } from "@/lib/projects";
import { ensureSharedProvider } from "@/lib/request-checks";
import { retryTransaction } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { projectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { ensureStandardProvider } from "../../../../../lib/request-checks";

export const projectsCrudHandlers = createLazyProxy(() => createCrudHandlers(projectsCrud, {
  paramsSchema: yupObject({}),
  onUpdate: async ({ auth, data }) => {
    const oldProject = auth.project;

    const result = await retryTransaction(async (tx) => {
      // ======================= update default team permissions =======================

      const dbParams = [
        {
          type: 'creator',
          optionName: 'team_creator_default_permissions',
          dbName: 'teamCreatorDefaultPermissions',
          dbSystemName: 'teamCreateDefaultSystemPermissions',
        },
        {
          type: 'member',
          optionName: 'team_member_default_permissions',
          dbName: 'teamMemberDefaultPermissions',
          dbSystemName: 'teamMemberDefaultSystemPermissions',
        },
      ] as const;

      const teamPermissions = await listPermissionDefinitions(tx, "TEAM", auth.tenancy);
      const userPermissions = await listPermissionDefinitions(tx, "USER", auth.tenancy);

      // Handle user default permissions
      const userDefaultPerms = data.config?.user_default_permissions?.map((p) => p.id);
      if (userDefaultPerms) {
        if (!userDefaultPerms.every((id) => userPermissions.some((perm) => perm.id === id))) {
          throw new StatusError(StatusError.BadRequest,
            `Invalid user default permission ids: ${userDefaultPerms.filter(id => !userPermissions.some(perm => perm.id === id)).join(', ')}`);
        }

        // Remove existing default user permissions
        await tx.permission.updateMany({
          where: {
            projectConfigId: oldProject.config.id,
          },
          data: {
            isDefaultUserPermission: false,
          },
        });

        // Add new default user permissions
        await tx.permission.updateMany({
          where: {
            projectConfigId: oldProject.config.id,
            queryableId: {
              in: userDefaultPerms,
            },
          },
          data: {
            isDefaultUserPermission: true,
          },
        });
      }

      for (const param of dbParams) {
        const defaultPerms = data.config?.[param.optionName]?.map((p) => p.id);

        if (!defaultPerms) {
          continue;
        }

        if (!defaultPerms.every((id) => teamPermissions.some((perm) => perm.id === id))) {
          throw new StatusError(StatusError.BadRequest, "Invalid team default permission ids");
        }

        const systemPerms = defaultPerms
          .filter(p => isTeamSystemPermission(p))
          .map(p => teamSystemPermissionStringToDBType(p as any));

        await tx.projectConfig.update({
          where: { id: oldProject.config.id },
          data: {
            [param.dbSystemName]: systemPerms,
          },
        });

        // Remove existing default permissions
        await tx.permission.updateMany({
          where: {
            projectConfigId: oldProject.config.id,
            scope: 'TEAM',
          },
          data: {
            isDefaultTeamCreatorPermission: param.type === 'creator' ? false : undefined,
            isDefaultTeamMemberPermission: param.type === 'member' ? false : undefined,
          },
        });

        // Add new default permissions
        await tx.permission.updateMany({
          where: {
            projectConfigId: oldProject.config.id,
            queryableId: {
              in: defaultPerms.filter(x => !isTeamSystemPermission(x)),
            },
            scope: 'TEAM',
          },
          data: {
            isDefaultTeamCreatorPermission: param.type === 'creator',
            isDefaultTeamMemberPermission: param.type === 'member',
          },
        });
      }

      // ======================= update email config =======================
      // update the corresponding config type if it is already defined
      // delete the other config type
      // create the config type if it is not defined

      const emailConfig = data.config?.email_config;
      if (emailConfig) {
        let updateData = {};

        if (emailConfig.type === 'shared') {
          const customTemplateCount = await tx.emailTemplate.count({
            where: { projectConfigId: oldProject.config.id },
          });

          if (customTemplateCount !== 0) {
            throw new StatusError(StatusError.BadRequest, 'Cannot change email service type to shared when custom templates are defined. Disable custom templates first, before changing the email service type.');
          }
        }

        await tx.standardEmailServiceConfig.deleteMany({
          where: { projectConfigId: oldProject.config.id },
        });
        await tx.proxiedEmailServiceConfig.deleteMany({
          where: { projectConfigId: oldProject.config.id },
        });


        if (emailConfig.type === 'standard') {
          updateData = {
            standardEmailServiceConfig: {
              create: {
                host: emailConfig.host ?? throwErr('host is required'),
                port: emailConfig.port ?? throwErr('port is required'),
                username: emailConfig.username ?? throwErr('username is required'),
                password: emailConfig.password ?? throwErr('password is required'),
                senderEmail: emailConfig.sender_email ?? throwErr('sender_email is required'),
                senderName: emailConfig.sender_name ?? throwErr('sender_name is required'),
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

        await tx.emailServiceConfig.update({
          where: { projectConfigId: oldProject.config.id },
          data: updateData,
        });
      }

      // ======================= update oauth config =======================
      // loop though all the items from crud.config.oauth_providers
      // create the config if it is not already in the DB
      // update the config if it is already in the DB
      // update/create all auth methods and connected account configs

      const oldProviders = oldProject.config.oauth_providers;
      const oauthProviderUpdates = data.config?.oauth_providers;
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
          switch (oldProvider.type) {
            case 'shared': {
              await tx.proxiedOAuthProviderConfig.deleteMany({
                where: { projectConfigId: oldProject.config.id, id: providerUpdate.id },
              });
              break;
            }
            case 'standard': {
              await tx.standardOAuthProviderConfig.deleteMany({
                where: { projectConfigId: oldProject.config.id, id: providerUpdate.id },
              });
              break;
            }
          }

          // update provider configs with newly created proxied/standard provider configs
          let providerConfigUpdate;
          if (providerUpdate.type === 'shared') {
            providerConfigUpdate = {
              proxiedOAuthConfig: {
                create: {
                  type: typedToUppercase(ensureSharedProvider(providerUpdate.id)),
                },
              },
            };
          } else {
            providerConfigUpdate = {
              standardOAuthConfig: {
                create: {
                  type: typedToUppercase(ensureStandardProvider(providerUpdate.id)),
                  clientId: providerUpdate.client_id ?? throwErr('client_id is required'),
                  clientSecret: providerUpdate.client_secret ?? throwErr('client_secret is required'),
                  facebookConfigId: providerUpdate.facebook_config_id,
                  microsoftTenantId: providerUpdate.microsoft_tenant_id,
                },
              },
            };
          }

          await tx.oAuthProviderConfig.update({
            where: { projectConfigId_id: { projectConfigId: oldProject.config.id, id } },
            data: {
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
                  type: typedToUppercase(ensureSharedProvider(provider.update.id)),
                },
              },
            };
          } else {
            providerConfigData = {
              standardOAuthConfig: {
                create: {
                  type: typedToUppercase(ensureStandardProvider(provider.update.id)),
                  clientId: provider.update.client_id ?? throwErr('client_id is required'),
                  clientSecret: provider.update.client_secret ?? throwErr('client_secret is required'),
                  facebookConfigId: provider.update.facebook_config_id,
                  microsoftTenantId: provider.update.microsoft_tenant_id,
                },
              },
            };
          }

          await tx.oAuthProviderConfig.create({
            data: {
              id: provider.id,
              projectConfigId: oldProject.config.id,
              ...providerConfigData,
            },
          });
        }

        // Update/create auth methods and connected account configs
        const providers = await tx.oAuthProviderConfig.findMany({
          where: {
            projectConfigId: oldProject.config.id,
          },
          include: {
            standardOAuthConfig: true,
            proxiedOAuthConfig: true,
          }
        });
        for (const provider of providers) {
          const enabled = oauthProviderUpdates.find((p) => p.id === provider.id)?.enabled ?? false;

          const authMethod = await tx.authMethodConfig.findFirst({
            where: {
              projectConfigId: oldProject.config.id,
              oauthProviderConfig: {
                id: provider.id,
              },
            }
          });

          if (!authMethod) {
            await tx.authMethodConfig.create({
              data: {
                projectConfigId: oldProject.config.id,
                enabled,
                oauthProviderConfig: {
                  connect: {
                    projectConfigId_id: {
                      projectConfigId: oldProject.config.id,
                      id: provider.id,
                    }
                  }
                }
              },
            });
          } else {
            await tx.authMethodConfig.update({
              where: {
                projectConfigId_id: {
                  projectConfigId: oldProject.config.id,
                  id: authMethod.id,
                }
              },
              data: {
                enabled,
              },
            });
          }

          const connectedAccount = await tx.connectedAccountConfig.findFirst({
            where: {
              projectConfigId: oldProject.config.id,
              oauthProviderConfig: {
                id: provider.id,
              },
            }
          });

          if (!connectedAccount) {
            if (provider.standardOAuthConfig) {
              await tx.connectedAccountConfig.create({
                data: {
                  projectConfigId: oldProject.config.id,
                  enabled,
                  oauthProviderConfig: {
                    connect: {
                      projectConfigId_id: {
                        projectConfigId: oldProject.config.id,
                        id: provider.id,
                      }
                    }
                  }
                },
              });
            }
          } else {
            await tx.connectedAccountConfig.update({
              where: {
                projectConfigId_id: {
                  projectConfigId: oldProject.config.id,
                  id: connectedAccount.id,
                }
              },
              data: {
                enabled: provider.standardOAuthConfig ? enabled : false,
              },
            });
          }
        }
      }

      // ======================= update password auth method =======================
      const passwordAuth = await tx.passwordAuthMethodConfig.findFirst({
        where: {
          projectConfigId: oldProject.config.id,
        },
      });
      if (data.config?.credential_enabled !== undefined) {
        if (!passwordAuth) {
          await tx.authMethodConfig.create({
            data: {
              projectConfigId: oldProject.config.id,
              enabled: data.config.credential_enabled,
              passwordConfig: {
                create: {},
              },
            },
          });
        } else {
          await tx.authMethodConfig.update({
            where: {
              projectConfigId_id: {
                projectConfigId: oldProject.config.id,
                id: passwordAuth.authMethodConfigId,
              },
            },
            data: {
              enabled: data.config.credential_enabled,
            },
          });
        }
      }

      // ======================= update OTP auth method =======================
      const otpAuth = await tx.otpAuthMethodConfig.findFirst({
        where: {
          projectConfigId: oldProject.config.id,
        },
      });
      if (data.config?.magic_link_enabled !== undefined) {
        if (!otpAuth) {
          await tx.authMethodConfig.create({
            data: {
              projectConfigId: oldProject.config.id,
              enabled: data.config.magic_link_enabled,
              otpConfig: {
                create: {
                  contactChannelType: "EMAIL",
                },
              },
            },
          });
        } else {
          await tx.authMethodConfig.update({
            where: {
              projectConfigId_id: {
                projectConfigId: oldProject.config.id,
                id: otpAuth.authMethodConfigId,
              },
            },
            data: {
              enabled: data.config.magic_link_enabled,
            },
          });
        }
      }

      // ======================= update passkey auth method =======================
      const passkeyAuth = await tx.passkeyAuthMethodConfig.findFirst({
        where: {
          projectConfigId: oldProject.config.id,
        },
      });
      if (data.config?.passkey_enabled !== undefined) {
        if (!passkeyAuth) {
          await tx.authMethodConfig.create({
            data: {
              projectConfigId: oldProject.config.id,
              enabled: data.config.passkey_enabled,
              passkeyConfig: {
                create: {
                  // passkey has no settings yet
                },
              },
            },
          });
        } else {
          await tx.authMethodConfig.update({
            where: {
              projectConfigId_id: {
                projectConfigId: oldProject.config.id,
                id: passkeyAuth.authMethodConfigId,
              },
            },
            data: {
              enabled: data.config.passkey_enabled,
            },
          });
        }
      }

      // ======================= update the rest =======================

      // check domain uniqueness
      if (data.config?.domains) {
        const domains = data.config.domains.map((item) => item.domain);
        if (new Set(domains).size !== domains.length) {
          throw new StatusError(StatusError.BadRequest, 'Duplicated domain found');
        }
      }

      return await tx.project.update({
        where: { id: auth.project.id },
        data: {
          displayName: data.display_name,
          description: data.description ?? "",
          isProductionMode: data.is_production_mode,
          config: {
            update: {
              signUpEnabled: data.config?.sign_up_enabled,
              clientTeamCreationEnabled: data.config?.client_team_creation_enabled,
              clientUserDeletionEnabled: data.config?.client_user_deletion_enabled,
              allowLocalhost: data.config?.allow_localhost,
              createTeamOnSignUp: data.config?.create_team_on_sign_up,
              oauthAccountMergeStrategy: data.config?.oauth_account_merge_strategy ? typedToUppercase(data.config.oauth_account_merge_strategy) : undefined,
              domains: data.config?.domains ? {
                deleteMany: {},
                create: data.config.domains.map(item => ({
                  domain: item.domain,
                  handlerPath: item.handler_path,
                })),
              } : undefined
            },
          }
        },
        include: fullProjectInclude,
      });
    });

    return projectPrismaToCrud(result);
  },
  onRead: async ({ auth }) => {
    return auth.project;
  },
  onDelete: async ({ auth }) => {
    await retryTransaction(async (tx) => {
      const configs = await tx.projectConfig.findMany({
        where: {
          id: auth.project.config.id
        },
        include: {
          projects: true
        }
      });

      if (configs.length !== 1) {
        throw new StackAssertionError("Project config should be unique", { configs });
      }

      await tx.projectConfig.delete({
        where: {
          id: auth.project.config.id
        },
      });

      // delete managed ids from users
      const users = await tx.projectUser.findMany({
        where: {
          mirroredProjectId: 'internal',
          serverMetadata: {
            path: ['managedProjectIds'],
            array_contains: auth.project.id
          }
        }
      });

      for (const user of users) {
        const updatedManagedProjectIds = (user.serverMetadata as any).managedProjectIds.filter(
          (id: any) => id !== auth.project.id
        ) as string[];

        await tx.projectUser.update({
          where: {
            mirroredProjectId_mirroredBranchId_projectUserId: {
              mirroredProjectId: 'internal',
              mirroredBranchId: user.mirroredBranchId,
              projectUserId: user.projectUserId
            }
          },
          data: {
            serverMetadata: {
              ...user.serverMetadata as any,
              managedProjectIds: updatedManagedProjectIds,
            }
          }
        });
      }
    });
  }
}));
