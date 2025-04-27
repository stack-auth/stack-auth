import { createOrUpdateProject } from "@/lib/projects";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { createCrud } from "@stackframe/stack-shared/dist/crud";
import * as schemaFields from "@stackframe/stack-shared/dist/schema-fields";
import { yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

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

export const oauthProvidersCrudHandlers = createLazyProxy(() => createCrudHandlers(oauthProvidersCrud, {
  paramsSchema: yupObject({
    oauth_provider_id: schemaFields.oauthIdSchema.defined(),
  }),
  onCreate: async ({ auth, data }) => {
    if (auth.tenancy.config.oauth_providers.find(provider => provider.id === data.id)) {
      throw new StatusError(StatusError.BadRequest, 'OAuth provider already exists');
    }

    const updated = await createOrUpdateProject({
      type: 'update',
      projectId: auth.project.id,
      data: {
        config: {
          oauth_providers: [
            ...auth.tenancy.config.oauth_providers,
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

    return updated.config.oauth_providers.find(provider => provider.id === data.id) ?? throwErr('Provider not found');
  },
  onUpdate: async ({ auth, data, params }) => {
    if (!auth.tenancy.config.oauth_providers.find(provider => provider.id === params.oauth_provider_id)) {
      throw new StatusError(StatusError.NotFound, 'OAuth provider not found');
    }

    const updated = await createOrUpdateProject({
      type: 'update',
      projectId: auth.project.id,
      data: {
        config: {
          oauth_providers: auth.project.config.oauth_providers
            .map(provider => provider.id === params.oauth_provider_id ? {
              ...provider,
              ...data,
            } : provider),
        }
      }
    });

    return updated.config.oauth_providers.find(provider => provider.id === params.oauth_provider_id) ?? throwErr('Provider not found');
  },
  onList: async ({ auth }) => {
    return {
      items: auth.tenancy.config.oauth_providers,
      is_paginated: false,
    };
  },
  onDelete: async ({ auth, params }) => {
    if (!auth.tenancy.config.oauth_providers.find(provider => provider.id === params.oauth_provider_id)) {
      throw new StatusError(StatusError.NotFound, 'OAuth provider not found');
    }

    const updated = await createOrUpdateProject({
      type: 'update',
      projectId: auth.project.id,
      data: {
        config: {
          oauth_providers: auth.project.config.oauth_providers.filter(provider =>
            provider.id !== params.oauth_provider_id
          )
        }
      }
    });
  },
}));
