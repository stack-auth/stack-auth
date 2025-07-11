import { createOrUpdateProject } from "@/lib/projects";
import { getTenancy } from "@/lib/tenancies";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { createCrud } from "@stackframe/stack-shared/dist/crud";
import * as schemaFields from "@stackframe/stack-shared/dist/schema-fields";
import { yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

const oauthProviderReadSchema = yupObject({
  id: schemaFields.oauthLegacyIdSchema.defined(),
  type: schemaFields.oauthLegacyTypeSchema.defined(),
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
  id: schemaFields.oauthLegacyIdSchema.defined(),
  type: schemaFields.oauthLegacyTypeSchema.optional(),
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
  id: schemaFields.oauthLegacyIdSchema.defined(),
}));

const oauthProviderDeleteSchema = yupObject({
  id: schemaFields.oauthLegacyIdSchema.defined(),
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

export const oauthProvidersCrudHandlers = createLazyProxy(() => createCrudHandlers(oauthProvidersCrud, {
  paramsSchema: yupObject({
    oauth_provider_id: schemaFields.oauthLegacyIdSchema.defined(),
  }),
  onCreate: async ({ auth, data }) => {
    if (auth.tenancy.config.oauth_providers.find(provider => provider.id === data.id)) {
      throw new StatusError(StatusError.BadRequest, 'OAuth provider already exists');
    }

    await createOrUpdateProject({
      type: 'update',
      projectId: auth.project.id,
      branchId: auth.branchId,
      data: {
        config: {
          oauth_providers: [
            ...auth.tenancy.config.oauth_providers,
            {
              type: data.id,
              is_shared: data.type === 'shared',
              client_id: data.client_id,
              client_secret: data.client_secret,
            }
          ]
        }
      }
    });
    const updatedTenancy = await getTenancy(auth.tenancy.id) ?? throwErr('Tenancy not found after update?'); // since we updated the config, we need to re-fetch the tenancy

    const provider = updatedTenancy.config.oauth_providers.find(provider => provider.id === data.id) ?? throwErr('Provider not found');
    return {
      ...provider,
      type: provider.is_shared ? 'shared' : 'standard',
      id: provider.type,
    };
  },
  onUpdate: async ({ auth, data, params }) => {
    if (!auth.tenancy.config.oauth_providers.find(provider => provider.id === params.oauth_provider_id)) {
      throw new StatusError(StatusError.NotFound, 'OAuth provider not found');
    }

    await createOrUpdateProject({
      type: 'update',
      projectId: auth.project.id,
      branchId: auth.branchId,
      data: {
        config: {
          oauth_providers: auth.tenancy.config.oauth_providers
            .map(provider => provider.id === params.oauth_provider_id ?
              {
                ...provider,
                ...data,
                type: data.id,
              } : provider),
        }
      }
    });
    const updatedTenancy = await getTenancy(auth.tenancy.id) ?? throwErr('Tenancy not found after update?'); // since we updated the config, we need to re-fetch the tenancy

    const provider = updatedTenancy.config.oauth_providers.find(provider => provider.id === params.oauth_provider_id) ?? throwErr('Provider not found');
    return {
      ...provider,
      type: provider.is_shared ? 'shared' : 'standard',
      id: provider.type,
    };
  },
  onList: async ({ auth }) => {
    return {
      items: auth.tenancy.config.oauth_providers.map(provider => ({
        ...provider,
        type: provider.is_shared ? 'shared' : 'standard',
        id: provider.type,
      })),
      is_paginated: false,
    };
  },
  onDelete: async ({ auth, params }) => {
    if (!auth.tenancy.config.oauth_providers.find(provider => provider.id === params.oauth_provider_id)) {
      throw new StatusError(StatusError.NotFound, 'OAuth provider not found');
    }

    await createOrUpdateProject({
      type: 'update',
      projectId: auth.project.id,
      branchId: auth.branchId,
      data: {
        config: {
          oauth_providers: auth.tenancy.config.oauth_providers.filter(provider =>
            provider.id !== params.oauth_provider_id
          )
        }
      }
    });
  },
}));
