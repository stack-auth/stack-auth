import { Tenancy } from "@/lib/tenancies";
import { prismaClient, retryTransaction } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { Prisma } from "@prisma/client";
import { CrudTypeOf, createCrud } from "@stackframe/stack-shared/dist/crud";
import * as schemaFields from "@stackframe/stack-shared/dist/schema-fields";
import { yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { sharedProviders } from "@stackframe/stack-shared/dist/utils/oauth";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { typedToLowercase, typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import * as yup from "yup";

const oauthProviderReadSchema = yupObject({
  id: schemaFields.oauthIdSchema.defined(),
  type: schemaFields.oauthTypeSchema.defined(),
  client_id: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.oauthClientIdSchema, {
    when: 'type',
    is: 'standard',
  }),
  client_secret: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.oauthClientSecretSchema, {
    when: 'type',
    is: 'standard',
  }),

  // extra params
  facebook_config_id: schemaFields.oauthFacebookConfigIdSchema.optional(),
  microsoft_tenant_id: schemaFields.oauthMicrosoftTenantIdSchema.optional(),
});

const oauthProviderUpdateSchema = yupObject({
  type: schemaFields.oauthTypeSchema.optional(),
  client_id: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.oauthClientIdSchema, {
    when: 'type',
    is: 'standard',
  }).optional(),
  client_secret: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.oauthClientSecretSchema, {
    when: 'type',
    is: 'standard',
  }).optional(),

  // extra params
  facebook_config_id: schemaFields.oauthFacebookConfigIdSchema.optional(),
  microsoft_tenant_id: schemaFields.oauthMicrosoftTenantIdSchema.optional(),
});

const oauthProviderCreateSchema = oauthProviderUpdateSchema.defined().concat(yupObject({
  id: schemaFields.oauthIdSchema.defined(),
}));

const oauthProviderDeleteSchema = yupObject({
  id: schemaFields.oauthIdSchema.defined(),
});

const oauthProvidersCrud = createCrud({
  adminReadSchema: oauthProviderReadSchema,
  adminCreateSchema: oauthProviderCreateSchema,
  adminUpdateSchema: oauthProviderUpdateSchema,
  adminDeleteSchema: oauthProviderDeleteSchema,
  docs: {
    adminList: {
      hidden: true,
    },
    adminCreate: {
      hidden: true,
    },
    adminUpdate: {
      hidden: true,
    },
    adminDelete: {
      hidden: true,
    },
  },
});

type OAuthProvidersCrud = CrudTypeOf<typeof oauthProvidersCrud>;

const getProvider = (tenancy: Tenancy, id: string, enabledRequired: boolean) => {
  return tenancy.config.oauth_providers
    .filter(provider => enabledRequired ? provider.enabled : true)
    .find(provider => provider.id === id);
};

const fullOAuthProviderInclude = {
  proxiedOAuthConfig: true,
  standardOAuthConfig: true,
} as const satisfies Prisma.OAuthProviderConfigInclude;

function oauthProviderPrismaToCrud(db: Prisma.OAuthProviderConfigGetPayload<{ include: typeof fullOAuthProviderInclude }>): OAuthProvidersCrud['Admin']['Read'] {
  return {
    id: typedToLowercase(db.proxiedOAuthConfig?.type || db.standardOAuthConfig?.type || throwErr('OAuth provider type is required')),
    type: db.proxiedOAuthConfig ? 'shared' : 'standard',
    client_id: db.standardOAuthConfig?.clientId,
    client_secret: db.standardOAuthConfig?.clientSecret,
    facebook_config_id: db.standardOAuthConfig?.facebookConfigId ?? undefined,
    microsoft_tenant_id: db.standardOAuthConfig?.microsoftTenantId ?? undefined,
  };
};

async function createOrUpdateProvider(
  options: {
    tenancy: Tenancy,
  } & ({
    type: 'create',
    data: OAuthProvidersCrud['Admin']['Create'],
  } | {
    type: 'update',
    id: NonNullable<yup.InferType<typeof schemaFields.oauthIdSchema>>,
    data: OAuthProvidersCrud['Admin']['Update'],
  })
): Promise<OAuthProvidersCrud['Admin']['Read']> {
  const providerId = options.type === 'create' ? options.data.id : options.id;
  const oldProvider = getProvider(options.tenancy, providerId, false);

  const providerIdIsShared = sharedProviders.includes(providerId as any);
  if (!providerIdIsShared && options.data.type === 'shared') {
    throw new StatusError(StatusError.BadRequest, `${providerId} is not a shared provider`);
  }

  return await retryTransaction(async (tx) => {
    if (oldProvider) {
      switch (oldProvider.type) {
        case 'shared': {
          await tx.proxiedOAuthProviderConfig.deleteMany({
            where: { projectConfigId: options.tenancy.config.id, id: providerId },
          });
          break;
        }
        case 'standard': {
          await tx.standardOAuthProviderConfig.deleteMany({
            where: { projectConfigId: options.tenancy.config.id, id: providerId },
          });
          break;
        }
      }

      const db = await tx.oAuthProviderConfig.update({
        where: {
          projectConfigId_id: {
            projectConfigId: options.tenancy.config.id,
            id: providerId,
          }
        },
        data: {
          ...options.data.type === 'shared' ? {
            proxiedOAuthConfig: {
              create: {
                type: typedToUppercase(providerId) as any,
              }
            },
          } : {
            standardOAuthConfig: {
              create: {
                type: typedToUppercase(providerId) as any,
                clientId: options.data.client_id || throwErr('client_id is required'),
                clientSecret: options.data.client_secret || throwErr('client_secret is required'),
                facebookConfigId: options.data.facebook_config_id,
                microsoftTenantId: options.data.microsoft_tenant_id,
              }
            },
          },
        },
        include: fullOAuthProviderInclude,
      });

      return oauthProviderPrismaToCrud(db);
    } else {
      if (options.type === 'update') {
        throw new StatusError(StatusError.NotFound, 'OAuth provider not found');
      }

      const db = await tx.authMethodConfig.create({
        data: {
          oauthProviderConfig: {
            create: {
              id: generateUuid(),
              ...options.data.type === 'shared' ? {
                proxiedOAuthConfig: {
                  create: {
                    type: typedToUppercase(providerId) as any,
                  }
                },
              } : {
                standardOAuthConfig: {
                  create: {
                    type: typedToUppercase(providerId) as any,
                    clientId: options.data.client_id || throwErr('client_id is required'),
                    clientSecret: options.data.client_secret || throwErr('client_secret is required'),
                    facebookConfigId: options.data.facebook_config_id,
                    microsoftTenantId: options.data.microsoft_tenant_id,
                  }
                },
              },
            }
          },
          projectConfigId: options.tenancy.config.id,
        },
        include: {
          oauthProviderConfig: {
            include: fullOAuthProviderInclude,
          }
        }
      });

      return oauthProviderPrismaToCrud(db.oauthProviderConfig || throwErr("provider config does not exist"));
    }
  });
};


export const oauthProvidersCrudHandlers = createLazyProxy(() => createCrudHandlers(oauthProvidersCrud, {
  paramsSchema: yupObject({
    oauth_provider_id: schemaFields.oauthIdSchema.defined(),
  }),
  onCreate: async ({ auth, data }) => {
    return await createOrUpdateProvider({
      tenancy: auth.tenancy,
      type: 'create',
      data,
    });
  },
  onUpdate: async ({ auth, data, params }) => {
    return await createOrUpdateProvider({
      tenancy: auth.tenancy,
      type: 'update',
      id: params.oauth_provider_id,
      data,
    });
  },
  onList: async ({ auth }) => {
    return {
      items: auth.tenancy.config.oauth_providers.filter(provider => provider.enabled),
      is_paginated: false,
    };
  },
  onDelete: async ({ auth, params }) => {
    const provider = getProvider(auth.tenancy, params.oauth_provider_id, false);
    if (!provider) {
      throw new StatusError(StatusError.NotFound, 'OAuth provider not found');
    }

    await prismaClient.authMethodConfig.updateMany({
      where: {
        projectConfigId: auth.tenancy.config.id,
        oauthProviderConfig: {
          id: params.oauth_provider_id,
        },
      },
      data: {
        enabled: false,
      },
    });
  },
}));
