import { ensureUserExists } from "@/lib/request-checks";
import { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { oauthProviderCrud } from "@stackframe/stack-shared/dist/interface/crud/oauth-providers";
import { userIdOrMeSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

// Helper function to check if a provider type is already used for signing in
async function checkProviderTypeAlreadyUsedForSignIn(options: {
  tenancy: Tenancy,
  oldAccountId?: string,
  accountId: string,
  providerType: string,
  config: any,
  excludeProviderConfigId?: string,
}): Promise<void> {
  const prismaClient = getPrismaClientForTenancy(options.tenancy);
  const oauthAccounts = await prismaClient.projectUserOAuthAccount.findMany({
    where: {
      tenancyId: options.tenancy.id,
      providerAccountId: options.accountId,
      oauthAuthMethod: {
        isNot: null,
      },
    },
    include: {
      oauthAuthMethod: true,
    },
  });

  for (const account of oauthAccounts) {
    // Skip the current provider if we're excluding it (for updates)
    if (options.excludeProviderConfigId && account.configOAuthProviderId === options.excludeProviderConfigId) {
      continue;
    }

    const providerConfig = options.config.auth?.oauth?.providers?.[account.configOAuthProviderId];
    if (providerConfig && providerConfig.type === options.providerType && options.oldAccountId !== options.accountId) {
      throw new StatusError(StatusError.BadRequest, `A provider of type "${options.providerType}" is already enabled for signing in for this user.`);
    }
  }
}

// Helper function to check if a provider type + account ID combination is already used for connected accounts
async function checkProviderAccountIdAlreadyUsedForConnectedAccounts(options: {
  tenancy: Tenancy,
  userId: string,
  providerType: string,
  accountId: string,
  config: any,
  excludeProviderConfigId?: string,
}): Promise<void> {
  const prismaClient = getPrismaClientForTenancy(options.tenancy);
  const oauthAccounts = await prismaClient.projectUserOAuthAccount.findMany({
    where: {
      tenancyId: options.tenancy.id,
      projectUserId: options.userId,
      providerAccountId: options.accountId,
      connectedAccount: {
        isNot: null,
      },
    },
    include: {
      connectedAccount: true,
    },
  });

  for (const account of oauthAccounts) {
    // Skip the current provider if we're excluding it (for updates)
    if (options.excludeProviderConfigId && account.configOAuthProviderId === options.excludeProviderConfigId) {
      continue;
    }

    const providerConfig = options.config.auth?.oauth?.providers?.[account.configOAuthProviderId];
    if (providerConfig && providerConfig.type === options.providerType) {
      throw new StatusError(StatusError.BadRequest, `A provider of type "${options.providerType}" with account ID "${options.accountId}" is already connected for this user.`);
    }
  }
}


export const oauthProviderCrudHandlers = createLazyProxy(() => createCrudHandlers(oauthProviderCrud, {
  paramsSchema: yupObject({
    provider_id: yupString().defined(),
    user_id: userIdOrMeSchema.defined(),
  }),
  querySchema: yupObject({
    user_id: userIdOrMeSchema.optional().meta({ openapiField: { onlyShowInOperations: ['List'] } }),
  }),
  async onRead({ auth, params }) {
    if (auth.type === 'client') {
      const currentUserId = auth.user?.id || throwErr(new KnownErrors.CannotGetOwnUserWithoutUser());
      if (currentUserId !== params.user_id) {
        throw new StatusError(StatusError.Forbidden, 'Client can only read OAuth providers for their own user.');
      }
    }

    const prismaClient = getPrismaClientForTenancy(auth.tenancy);
    await ensureUserExists(prismaClient, { tenancyId: auth.tenancy.id, userId: params.user_id });

    const oauthAccount = await prismaClient.projectUserOAuthAccount.findFirst({
      where: {
        tenancyId: auth.tenancy.id,
        configOAuthProviderId: params.provider_id,
        projectUserId: params.user_id,
      },
      include: {
        connectedAccount: true,
        oauthAuthMethod: true,
      },
    });

    if (!oauthAccount) {
      throw new StatusError(StatusError.NotFound, 'OAuth provider not found for this user');
    }

    // Get the provider configuration from the tenancy config
    const config = auth.tenancy.completeConfig;
    let providerConfig: (typeof config.auth.oauth.providers)[number] & { id: string } | undefined;
    for (const [providerId, provider] of Object.entries(config.auth.oauth.providers)) {
      if (providerId === params.provider_id) {
        providerConfig = {
          id: providerId,
          ...provider,
        };
        break;
      }
    }

    if (!providerConfig) {
      throw new StatusError(StatusError.NotFound, `OAuth provider ${params.provider_id} not found or not configured`);
    }

    return {
      user_id: params.user_id,
      id: providerConfig.id,
      email: oauthAccount.email || undefined,
      type: providerConfig.type as any, // Type assertion to match schema
      allow_sign_in: !!oauthAccount.oauthAuthMethod,
      allow_connected_accounts: !!oauthAccount.connectedAccount,
      account_id: oauthAccount.providerAccountId,
    };
  },
  async onList({ auth, query }) {
    if (auth.type === 'client') {
      const currentUserId = auth.user?.id || throwErr(new KnownErrors.CannotGetOwnUserWithoutUser());
      if (currentUserId !== query.user_id) {
        throw new StatusError(StatusError.Forbidden, 'Client can only list OAuth providers for their own user.');
      }
    }

    const prismaClient = getPrismaClientForTenancy(auth.tenancy);

    if (query.user_id) {
      await ensureUserExists(prismaClient, { tenancyId: auth.tenancy.id, userId: query.user_id });
    }

    const oauthAccounts = await prismaClient.projectUserOAuthAccount.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        projectUserId: query.user_id,
      },
      include: {
        connectedAccount: true,
        oauthAuthMethod: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    // Get the provider configurations from the tenancy config
    const config = auth.tenancy.completeConfig;
    const providerConfigs = new Map<string, (typeof config.auth.oauth.providers)[number] & { id: string }>();
    for (const [providerId, provider] of Object.entries(config.auth.oauth.providers)) {
      providerConfigs.set(providerId, {
        id: providerId,
        ...provider,
      });
    }

    const items = oauthAccounts
      .map((oauthAccount) => {
        const providerConfig = providerConfigs.get(oauthAccount.configOAuthProviderId);
        if (!providerConfig) {
          // Skip OAuth accounts for providers that are no longer configured
          return null;
        }

        return {
          user_id: oauthAccount.projectUserId,
          id: providerConfig.id,
          email: oauthAccount.email || undefined,
          type: providerConfig.type as any, // Type assertion to match schema
          allow_sign_in: !!oauthAccount.oauthAuthMethod,
          allow_connected_accounts: !!oauthAccount.connectedAccount,
          account_id: oauthAccount.providerAccountId,
        };
      })
      .filter(item => item !== null) as any[]; // Filter out null values and type assertion

    return {
      items,
      is_paginated: false,
    };
  },
  async onUpdate({ auth, data, params }) {
    if (auth.type === 'client') {
      const currentUserId = auth.user?.id || throwErr(new KnownErrors.CannotGetOwnUserWithoutUser());
      if (currentUserId !== params.user_id) {
        throw new StatusError(StatusError.Forbidden, 'Client can only update OAuth providers for their own user.');
      }
    }

    const prismaClient = getPrismaClientForTenancy(auth.tenancy);
    await ensureUserExists(prismaClient, { tenancyId: auth.tenancy.id, userId: params.user_id });

    const result = await retryTransaction(prismaClient, async (tx) => {
      // Find the existing OAuth account
      const existingOAuthAccount = await tx.projectUserOAuthAccount.findFirst({
        where: {
          tenancyId: auth.tenancy.id,
          configOAuthProviderId: params.provider_id,
          projectUserId: params.user_id,
        },
        include: {
          connectedAccount: true,
          oauthAuthMethod: true,
        },
      });

      if (!existingOAuthAccount) {
        throw new StatusError(StatusError.NotFound, 'OAuth provider not found for this user');
      }

      // Get the provider configuration from the tenancy config
      const config = auth.tenancy.completeConfig;
      let providerConfig: (typeof config.auth.oauth.providers)[number] & { id: string } | undefined;
      for (const [providerId, provider] of Object.entries(config.auth.oauth.providers)) {
        if (providerId === params.provider_id) {
          providerConfig = {
            id: providerId,
            ...provider,
          };
          break;
        }
      }

      if (!providerConfig) {
        throw new StatusError(StatusError.NotFound, `OAuth provider ${params.provider_id} not found or not configured`);
      }

      // Handle allow_sign_in changes
      if (data.allow_sign_in !== undefined) {
        if (data.allow_sign_in) {
          // Check if this provider type is already used for signing in by another provider
          await checkProviderTypeAlreadyUsedForSignIn({
            tenancy: auth.tenancy,
            oldAccountId: existingOAuthAccount.providerAccountId,
            accountId: data.account_id || existingOAuthAccount.providerAccountId,
            providerType: providerConfig.type || throwErr('Provider type is required'),
            config,
            excludeProviderConfigId: params.provider_id,
          });

          // Create auth method if it doesn't exist
          if (!existingOAuthAccount.oauthAuthMethod) {
            const authMethod = await tx.authMethod.create({
              data: {
                tenancyId: auth.tenancy.id,
                projectUserId: params.user_id,
                oauthAuthMethod: {
                  create: {
                    configOAuthProviderId: params.provider_id,
                    projectUserId: params.user_id,
                    providerAccountId: data.account_id || existingOAuthAccount.providerAccountId,
                  },
                },
              },
            });

            // The relationship is established automatically through the composite foreign key
          }
        } else {
          // Delete auth method if it exists
          if (existingOAuthAccount.oauthAuthMethod) {
            await tx.authMethod.delete({
              where: {
                tenancyId_id: {
                  tenancyId: auth.tenancy.id,
                  id: existingOAuthAccount.oauthAuthMethod.authMethodId,
                },
              },
            });
          }
        }
      }

      // Handle allow_connected_accounts changes
      if (data.allow_connected_accounts !== undefined) {
        if (data.allow_connected_accounts) {
          // Check if this provider type + account ID combination is already used for connected accounts
          await checkProviderAccountIdAlreadyUsedForConnectedAccounts({
            tenancy: auth.tenancy,
            userId: params.user_id,
            providerType: providerConfig.type || throwErr('Provider type is required'),
            accountId: data.account_id || existingOAuthAccount.providerAccountId,
            config,
            excludeProviderConfigId: params.provider_id,
          });

          // Create connected account if it doesn't exist
          if (!existingOAuthAccount.connectedAccount) {
            const connectedAccount = await tx.connectedAccount.create({
              data: {
                tenancyId: auth.tenancy.id,
                projectUserId: params.user_id,
                configOAuthProviderId: params.provider_id,
                providerAccountId: data.account_id || existingOAuthAccount.providerAccountId,
              },
            });

            // The relationship is established automatically through the composite foreign key
          }
        } else {
          // Delete connected account if it exists
          if (existingOAuthAccount.connectedAccount) {
            await tx.connectedAccount.delete({
              where: {
                tenancyId_id: {
                  tenancyId: auth.tenancy.id,
                  id: existingOAuthAccount.connectedAccount.id,
                },
              },
            });
          }
        }
      }

      // Handle email and account_id updates
      const updateData: any = {};
      if (data.email !== undefined) {
        updateData.email = data.email;
      }
      if (data.account_id !== undefined) {
        updateData.providerAccountId = data.account_id;
      }

      // Update the main OAuth account record if there are any changes
      // This will automatically update related records via ON UPDATE CASCADE
      let updatedOAuthAccount = existingOAuthAccount;
      if (Object.keys(updateData).length > 0) {
        updatedOAuthAccount = await tx.projectUserOAuthAccount.update({
          where: {
            tenancyId_configOAuthProviderId_providerAccountId: {
              tenancyId: auth.tenancy.id,
              configOAuthProviderId: params.provider_id,
              providerAccountId: existingOAuthAccount.providerAccountId,
            },
          },
          data: updateData,
          include: {
            connectedAccount: true,
            oauthAuthMethod: true,
          },
        });
      } else {
        // Refresh the include data to get updated relationships
        updatedOAuthAccount = await tx.projectUserOAuthAccount.findFirst({
          where: {
            tenancyId: auth.tenancy.id,
            configOAuthProviderId: params.provider_id,
            projectUserId: params.user_id,
          },
          include: {
            connectedAccount: true,
            oauthAuthMethod: true,
          },
        }) || existingOAuthAccount;
      }

      return {
        user_id: params.user_id,
        id: providerConfig.id,
        email: updatedOAuthAccount.email || undefined,
        type: providerConfig.type as any,
        allow_sign_in: !!updatedOAuthAccount.oauthAuthMethod,
        allow_connected_accounts: !!updatedOAuthAccount.connectedAccount,
        account_id: updatedOAuthAccount.providerAccountId,
      };
    });

    return result;
  },
  async onDelete({ auth, params }) {
    if (auth.type === 'client') {
      const currentUserId = auth.user?.id || throwErr(new KnownErrors.CannotGetOwnUserWithoutUser());
      if (currentUserId !== params.user_id) {
        throw new StatusError(StatusError.Forbidden, 'Client can only delete OAuth providers for their own user.');
      }
    }

    const prismaClient = getPrismaClientForTenancy(auth.tenancy);
    await ensureUserExists(prismaClient, { tenancyId: auth.tenancy.id, userId: params.user_id });

    await retryTransaction(prismaClient, async (tx) => {
      // Find the existing OAuth account with all related records
      const existingOAuthAccount = await tx.projectUserOAuthAccount.findFirst({
        where: {
          tenancyId: auth.tenancy.id,
          configOAuthProviderId: params.provider_id,
          projectUserId: params.user_id,
        },
        include: {
          connectedAccount: true,
          oauthAuthMethod: true,
        },
      });

      if (!existingOAuthAccount) {
        throw new StatusError(StatusError.NotFound, 'OAuth provider not found for this user');
      }

      // Delete related records in the correct order to avoid foreign key constraint violations

      // 1. Delete AuthMethod (this will cascade delete OAuthAuthMethod)
      if (existingOAuthAccount.oauthAuthMethod) {
        await tx.authMethod.delete({
          where: {
            tenancyId_id: {
              tenancyId: auth.tenancy.id,
              id: existingOAuthAccount.oauthAuthMethod.authMethodId,
            },
          },
        });
      }

      // 2. Delete ConnectedAccount
      if (existingOAuthAccount.connectedAccount) {
        await tx.connectedAccount.delete({
          where: {
            tenancyId_id: {
              tenancyId: auth.tenancy.id,
              id: existingOAuthAccount.connectedAccount.id,
            },
          },
        });
      }

      // 3. Delete the main OAuth account record
      await tx.projectUserOAuthAccount.delete({
        where: {
          tenancyId_configOAuthProviderId_providerAccountId: {
            tenancyId: auth.tenancy.id,
            configOAuthProviderId: params.provider_id,
            providerAccountId: existingOAuthAccount.providerAccountId,
          },
        },
      });
    });
  },
  async onCreate({ auth, data }) {
    const config = auth.tenancy.completeConfig;

    let providerConfig: (typeof config.auth.oauth.providers)[number] & { id: string } | undefined;
    for (const [providerConfigId, provider] of Object.entries(config.auth.oauth.providers)) {
      if (providerConfigId === data.provider_id) {
        providerConfig = {
          id: providerConfigId,
          ...provider,
        };
        break;
      }
    }

    const prismaClient = getPrismaClientForTenancy(auth.tenancy);
    await ensureUserExists(prismaClient, { tenancyId: auth.tenancy.id, userId: data.user_id });

    if (!providerConfig) {
      throw new StatusError(StatusError.BadRequest, `Provider with config ID ${data.provider_id} is not configured. Please check your Stack Auth dashboard OAuth configuration.`);
    }

    // Check if this provider type is already used for signing in
    await checkProviderTypeAlreadyUsedForSignIn({
      tenancy: auth.tenancy,
      oldAccountId: data.account_id,
      accountId: data.account_id,
      providerType: providerConfig.type || throwErr('Provider type is required'),
      config,
      excludeProviderConfigId: data.provider_id,
    });

    // Check if this provider type + account ID combination is already used for connected accounts
    await checkProviderAccountIdAlreadyUsedForConnectedAccounts({
      tenancy: auth.tenancy,
      userId: data.user_id,
      providerType: providerConfig.type || throwErr('Provider type is required'),
      accountId: data.account_id,
      config,
      excludeProviderConfigId: data.provider_id,
    });

    await retryTransaction(prismaClient, async (tx) => {
      // 1. Create the main OAuth account record first (required by foreign key constraints)
      await tx.projectUserOAuthAccount.create({
        data: {
          configOAuthProviderId: providerConfig!.id,
          providerAccountId: data.account_id,
          email: data.email,
          projectUserId: data.user_id,
          tenancyId: auth.tenancy.id,
        },
      });

      // 2. Create AuthMethod if needed
      if (data.allow_sign_in) {
        await tx.authMethod.create({
          data: {
            oauthAuthMethod: {
              create: {
                configOAuthProviderId: providerConfig!.id,
                projectUserId: data.user_id,
                providerAccountId: data.account_id,
              },
            },
            tenancyId: auth.tenancy.id,
            projectUserId: data.user_id,
          },
        });
      }

      // 3. Create ConnectedAccount if needed (references the OAuth account created above)
      if (data.allow_connected_accounts) {
        await tx.connectedAccount.create({
          data: {
            configOAuthProviderId: providerConfig!.id,
            tenancyId: auth.tenancy.id,
            projectUserId: data.user_id,
            providerAccountId: data.account_id,
          },
        });
      }
    });

    return {
      user_id: data.user_id,
      email: data.email,
      id: providerConfig.id,
      type: providerConfig.type as any,
      allow_sign_in: data.allow_sign_in,
      allow_connected_accounts: data.allow_connected_accounts,
      account_id: data.account_id,
    };
  },
}));
