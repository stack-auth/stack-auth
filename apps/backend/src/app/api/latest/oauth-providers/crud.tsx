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
async function checkInputValidity(options: {
  tenancy: Tenancy,
} & ({
  type: 'update',
  providerId: string,
  accountId?: string,
  userId: string,
  allowSignIn?: boolean,
  allowConnectedAccounts?: boolean,
} | {
  type: 'create',
  providerConfigId: string,
  accountId: string,
  userId: string,
  allowSignIn: boolean,
  allowConnectedAccounts: boolean,
})): Promise<void> {
  const prismaClient = getPrismaClientForTenancy(options.tenancy);

  let providerConfigId: string;
  if (options.type === 'update') {
    const existingProvider = await prismaClient.projectUserOAuthAccount.findUnique({
      where: {
        tenancyId_id: {
          tenancyId: options.tenancy.id,
          id: options.providerId,
        },
      },
    });
    if (!existingProvider) {
      throw new StatusError(StatusError.NotFound, `OAuth provider ${options.providerId} not found`);
    }
    providerConfigId = existingProvider.configOAuthProviderId;
  } else {
    providerConfigId = options.providerConfigId;
  }

  const providersWithTheSameAccountId = (await prismaClient.projectUserOAuthAccount.findMany({
    where: {
      tenancyId: options.tenancy.id,
      providerAccountId: options.accountId,
    },
  })).filter(p => p.id !== (options.type === 'update' ? options.providerId : undefined));

  const providersWithTheSameTypeAndSameUser = (await prismaClient.projectUserOAuthAccount.findMany({
    where: {
      tenancyId: options.tenancy.id,
      configOAuthProviderId: providerConfigId,
      projectUserId: options.userId,
    },
  })).filter(p => p.id !== (options.type === 'update' ? options.providerId : undefined));

  if (options.allowSignIn && providersWithTheSameAccountId.length > 0) {
    throw new KnownErrors.OAuthProviderTypeAlreadyUsedForSignIn();
  }

  if (options.allowConnectedAccounts && providersWithTheSameTypeAndSameUser.length > 0) {
    throw new KnownErrors.OAuthProviderAccountIdAlreadyUsedForConnectedAccounts();
  }
}

function getProviderConfig(tenancy: Tenancy, providerConfigId: string) {
  const config = tenancy.completeConfig;
  let providerConfig: (typeof config.auth.oauth.providers)[number] & { id: string } | undefined;
  for (const [providerId, provider] of Object.entries(config.auth.oauth.providers)) {
    if (providerId === providerConfigId) {
      providerConfig = {
        id: providerId,
        ...provider,
      };
      break;
    }
  }

  if (!providerConfig) {
    throw new StatusError(StatusError.NotFound, `OAuth provider ${providerConfigId} not found or not configured`);
  }

  return providerConfig;
}


export const oauthProviderCrudHandlers = createLazyProxy(() => createCrudHandlers(oauthProviderCrud, {
  paramsSchema: yupObject({
    provider_id: yupString().uuid().defined(),
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

    const oauthAccount = await prismaClient.projectUserOAuthAccount.findUnique({
      where: {
        tenancyId_id: {
          tenancyId: auth.tenancy.id,
          id: params.provider_id,
        },
      },
    });

    if (!oauthAccount) {
      throw new StatusError(StatusError.NotFound, 'OAuth provider not found for this user');
    }

    const providerConfig = getProviderConfig(auth.tenancy, oauthAccount.configOAuthProviderId);

    return {
      user_id: params.user_id,
      id: oauthAccount.id,
      email: oauthAccount.email || undefined,
      type: providerConfig.type as any, // Type assertion to match schema
      allow_sign_in: oauthAccount.allowSignIn,
      allow_connected_accounts: oauthAccount.allowConnectedAccounts,
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
      orderBy: {
        createdAt: 'asc',
      },
    });

    return {
      items: oauthAccounts
        .map((oauthAccount) => {
          const providerConfig = getProviderConfig(auth.tenancy, oauthAccount.configOAuthProviderId);

          return {
            user_id: oauthAccount.projectUserId || throwErr("OAuth account has no project user ID"),
            id: oauthAccount.id,
            email: oauthAccount.email || undefined,
            type: providerConfig.type as any, // Type assertion to match schema
            allow_sign_in: oauthAccount.allowSignIn,
            allow_connected_accounts: oauthAccount.allowConnectedAccounts,
            account_id: oauthAccount.providerAccountId,
          };
        }),
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
    const providerConfig = getProviderConfig(auth.tenancy, params.provider_id);

    await checkInputValidity({
      tenancy: auth.tenancy,
      type: 'update',
      providerId: params.provider_id,
      accountId: data.account_id,
      userId: params.user_id,
      allowSignIn: data.allow_sign_in,
      allowConnectedAccounts: data.allow_connected_accounts,
    });

    const result = await retryTransaction(prismaClient, async (tx) => {
      // Find the existing OAuth account
      const existingOAuthAccount = await tx.projectUserOAuthAccount.findUnique({
        where: {
          tenancyId_id: {
            tenancyId: auth.tenancy.id,
            id: params.provider_id,
          },
        },
        include: {
          oauthAuthMethod: true,
        },
      });

      if (!existingOAuthAccount) {
        throw new StatusError(StatusError.NotFound, 'OAuth provider not found for this user');
      }

      // Handle allow_sign_in changes
      if (data.allow_sign_in !== undefined) {
        await tx.projectUserOAuthAccount.update({
          where: {
            tenancyId_configOAuthProviderId_projectUserId_providerAccountId: {
              tenancyId: auth.tenancy.id,
              configOAuthProviderId: params.provider_id,
              projectUserId: params.user_id,
              providerAccountId: existingOAuthAccount.providerAccountId,
            },
          },
          data: {
            allowSignIn: data.allow_sign_in,
          },
        });

        if (data.allow_sign_in) {
          if (!existingOAuthAccount.oauthAuthMethod) {
            await tx.authMethod.create({
              data: {
                tenancyId: auth.tenancy.id,
                projectUserId: params.user_id,
                oauthAuthMethod: {
                  create: {
                    configOAuthProviderId: params.provider_id,
                    projectUserId: params.user_id,
                    providerAccountId: existingOAuthAccount.providerAccountId,
                  },
                },
              },
            });
          }
        } else {
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
        await tx.projectUserOAuthAccount.update({
          where: {
            tenancyId_id: {
              tenancyId: auth.tenancy.id,
              id: existingOAuthAccount.id,
            },
          },
          data: {
            allowConnectedAccounts: data.allow_connected_accounts,
          },
        });
      }

      await tx.projectUserOAuthAccount.update({
        where: {
          tenancyId_id: {
            tenancyId: auth.tenancy.id,
            id: params.provider_id,
          },
        },
        data: {
          email: data.email,
          providerAccountId: data.account_id,
        },
      });

      return {
        user_id: params.user_id,
        id: existingOAuthAccount.id,
        email: data.email || existingOAuthAccount.email || undefined,
        type: providerConfig.type as any,
        allow_sign_in: data.allow_sign_in || existingOAuthAccount.allowSignIn,
        allow_connected_accounts: data.allow_connected_accounts || existingOAuthAccount.allowConnectedAccounts,
        account_id: data.account_id || existingOAuthAccount.providerAccountId,
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
      const existingOAuthAccounts = await tx.projectUserOAuthAccount.findMany({
        where: {
          tenancyId: auth.tenancy.id,
          id: params.provider_id,
        },
        include: {
          oauthAuthMethod: true,
        },
      });

      if (existingOAuthAccounts.length === 0) {
        throw new StatusError(StatusError.NotFound, 'OAuth provider not found for this user');
      }

      if (existingOAuthAccounts[0].oauthAuthMethod) {
        await tx.authMethod.delete({
          where: {
            tenancyId_id: {
              tenancyId: auth.tenancy.id,
              id: existingOAuthAccounts[0].oauthAuthMethod.authMethodId,
            },
          },
        });
      }

      await tx.projectUserOAuthAccount.delete({
        where: {
          tenancyId_id: {
            tenancyId: auth.tenancy.id,
            id: params.provider_id,
          },
        },
      });
    });
  },
  async onCreate({ auth, data }) {
    const prismaClient = getPrismaClientForTenancy(auth.tenancy);
    const providerConfig = getProviderConfig(auth.tenancy, data.provider_config_id);

    await ensureUserExists(prismaClient, { tenancyId: auth.tenancy.id, userId: data.user_id });

    await checkInputValidity({
      tenancy: auth.tenancy,
      type: 'create',
      providerConfigId: data.provider_config_id,
      accountId: data.account_id,
      userId: data.user_id,
      allowSignIn: data.allow_sign_in,
      allowConnectedAccounts: data.allow_connected_accounts,
    });

    const created = await retryTransaction(prismaClient, async (tx) => {
      const created = await tx.projectUserOAuthAccount.create({
        data: {
          tenancyId: auth.tenancy.id,
          projectUserId: data.user_id,
          configOAuthProviderId: data.provider_config_id,
          providerAccountId: data.account_id,
          email: data.email,
          allowSignIn: data.allow_sign_in,
          allowConnectedAccounts: data.allow_connected_accounts,
        },
      });

      if (data.allow_sign_in) {
        await tx.authMethod.create({
          data: {
            tenancyId: auth.tenancy.id,
            projectUserId: data.user_id,
            oauthAuthMethod: {
              create: {
                configOAuthProviderId: data.provider_config_id,
                projectUserId: data.user_id,
                providerAccountId: data.account_id,
              },
            },
          },
        });
      }

      return created;
    });

    return {
      user_id: data.user_id,
      email: data.email,
      id: created.id,
      type: providerConfig.type as any,
      allow_sign_in: data.allow_sign_in,
      allow_connected_accounts: data.allow_connected_accounts,
      account_id: data.account_id,
    };
  },
}));
