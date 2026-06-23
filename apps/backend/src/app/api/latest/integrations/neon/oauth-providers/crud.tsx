import { createOrUpdateProjectWithLegacyConfig } from "@/lib/projects";
import { Tenancy, getTenancy } from "@/lib/tenancies";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { createCrud } from "@hexclave/shared/dist/crud";
import * as schemaFields from "@hexclave/shared/dist/schema-fields";
import { yupObject } from "@hexclave/shared/dist/schema-fields";
import { StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { createLazyProxy } from "@hexclave/shared/dist/utils/proxies";

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

/**
 * Returns only standard/shared providers for the legacy Neon integration API.
 * Custom OIDC providers are excluded since they don't fit the legacy schema.
 */
function getStandardProviders(config: Tenancy['config']) {
  return Object.values(config.auth.oauth.providers).filter(p => p.type !== "custom_oidc");
}

function oauthProviderConfigToLegacyConfig(provider: Tenancy['config']['auth']['oauth']['providers'][string]) {
  const providerType = provider.type;
  if (providerType === "custom_oidc") {
    throwErr("oauthProviderConfigToLegacyConfig must not be called with custom_oidc providers");
  }
  return {
    id: providerType || throwErr('Provider type is required'),
    type: provider.isShared ? 'shared' : 'standard',
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    facebook_config_id: provider.facebookConfigId,
    microsoft_tenant_id: provider.microsoftTenantId,
  } as const;
}

function findLegacyProvider(tenancy: Tenancy, providerType: string) {
  const providerRaw = Object.entries(tenancy.config.auth.oauth.providers).find(([_, provider]) => provider.type === providerType);
  if (!providerRaw) {
    return null;
  }
  return oauthProviderConfigToLegacyConfig(providerRaw[1]);
}

export const oauthProvidersCrudHandlers = createLazyProxy(() => createCrudHandlers(oauthProvidersCrud, {
  paramsSchema: yupObject({
    oauth_provider_id: schemaFields.oauthIdSchema.defined(),
  }),
  onCreate: async ({ auth, data }) => {
    if (findLegacyProvider(auth.tenancy, data.id)) {
      throw new StatusError(StatusError.BadRequest, 'OAuth provider already exists');
    }

    await createOrUpdateProjectWithLegacyConfig({
      type: 'update',
      projectId: auth.project.id,
      branchId: auth.branchId,
      data: {
        config: {
          oauth_providers: [
            ...getStandardProviders(auth.tenancy.config).map(oauthProviderConfigToLegacyConfig),
            {
              id: data.id,
              type: data.type ?? 'shared',
              client_id: data.client_id,
              client_secret: data.client_secret,
            }
          ]
        }
      }
    });
    const updatedTenancy = await getTenancy(auth.tenancy.id) ?? throwErr('Tenancy not found after update?'); // since we updated the config, we need to re-fetch the tenancy

    return findLegacyProvider(updatedTenancy, data.id) ?? throwErr('Provider not found');
  },
  onUpdate: async ({ auth, data, params }) => {
    if (!findLegacyProvider(auth.tenancy, params.oauth_provider_id)) {
      throw new StatusError(StatusError.NotFound, 'OAuth provider not found');
    }

    await createOrUpdateProjectWithLegacyConfig({
      type: 'update',
      projectId: auth.project.id,
      branchId: auth.branchId,
      data: {
        config: {
          oauth_providers: getStandardProviders(auth.tenancy.config)
            .map(provider => provider.type === params.oauth_provider_id ? {
              ...oauthProviderConfigToLegacyConfig(provider),
              ...data,
            } : oauthProviderConfigToLegacyConfig(provider)),
        }
      }
    });
    const updatedTenancy = await getTenancy(auth.tenancy.id) ?? throwErr('Tenancy not found after update?'); // since we updated the config, we need to re-fetch the tenancy

    return findLegacyProvider(updatedTenancy, params.oauth_provider_id) ?? throwErr('Provider not found');
  },
  onList: async ({ auth }) => {
    return {
      items: getStandardProviders(auth.tenancy.config).map(oauthProviderConfigToLegacyConfig),
      is_paginated: false,
    };
  },
  onDelete: async ({ auth, params }) => {
    if (!findLegacyProvider(auth.tenancy, params.oauth_provider_id)) {
      throw new StatusError(StatusError.NotFound, 'OAuth provider not found');
    }

    await createOrUpdateProjectWithLegacyConfig({
      type: 'update',
      projectId: auth.project.id,
      branchId: auth.branchId,
      data: {
        config: {
          oauth_providers: getStandardProviders(auth.tenancy.config)
            .filter(provider => provider.type !== params.oauth_provider_id)
            .map(oauthProviderConfigToLegacyConfig),
        }
      }
    });
  },
}));
