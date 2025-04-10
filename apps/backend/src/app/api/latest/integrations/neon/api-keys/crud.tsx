import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { CrudTypeOf, createCrud } from "@stackframe/stack-shared/dist/crud";
import { yupBoolean, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { internalApiKeyCrudHandlers } from "../../../internal/api-keys/crud";

const baseApiKeysReadSchema = yupObject({
  id: yupString().defined(),
  description: yupString().defined(),
  expires_at_millis: yupNumber().defined(),
  manually_revoked_at_millis: yupNumber().optional(),
  created_at_millis: yupNumber().defined(),
});

// Used for the result of the create endpoint
export const apiKeysCreateInputSchema = yupObject({
  description: yupString().defined(),
  expires_at_millis: yupNumber().defined(),
  has_publishable_client_key: yupBoolean().defined(),
  has_secret_server_key: yupBoolean().defined(),
  has_super_secret_admin_key: yupBoolean().defined(),
});

export const apiKeysCreateOutputSchema = baseApiKeysReadSchema.concat(yupObject({
  publishable_client_key: yupString().optional(),
  secret_server_key: yupString().optional(),
  super_secret_admin_key: yupString().optional(),
}).defined());

// Used for list, read and update endpoints after the initial creation
export const apiKeysCrudAdminObfuscatedReadSchema = baseApiKeysReadSchema.concat(yupObject({
  publishable_client_key: yupObject({
    last_four: yupString().defined(),
  }).optional(),
  secret_server_key: yupObject({
    last_four: yupString().defined(),
  }).optional(),
  super_secret_admin_key: yupObject({
    last_four: yupString().defined(),
  }).optional(),
}));

export const apiKeysCrudAdminUpdateSchema = yupObject({
  description: yupString().optional(),
  revoked: yupBoolean().oneOf([true]).optional(),
}).defined();

export const apiKeysCrudAdminDeleteSchema = yupMixed();

export const apiKeysCrud = createCrud({
  adminReadSchema: apiKeysCrudAdminObfuscatedReadSchema,
  adminUpdateSchema: apiKeysCrudAdminUpdateSchema,
  adminDeleteSchema: apiKeysCrudAdminDeleteSchema,
  docs: {
    adminList: {
      hidden: true,
    },
    adminRead: {
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
export type ApiKeysCrud = CrudTypeOf<typeof apiKeysCrud>;


export const apiKeyCrudHandlers = createLazyProxy(() => createCrudHandlers(apiKeysCrud, {
  paramsSchema: yupObject({
    api_key_id: yupString().defined(),
  }),
  onUpdate: async ({ auth, data, params }) => {
    return await internalApiKeyCrudHandlers.adminUpdate({
      data,
      tenancy: auth.tenancy,
      api_key_id: params.api_key_id,
    });
  },
  onDelete: async ({ auth, params }) => {
    return await internalApiKeyCrudHandlers.adminDelete({
      tenancy: auth.tenancy,
      api_key_id: params.api_key_id,
    });
  },
  onList: async ({ auth }) => {
    return await internalApiKeyCrudHandlers.adminList({
      tenancy: auth.tenancy,
    });
  },
  onRead: async ({ auth, params }) => {
    return await internalApiKeyCrudHandlers.adminRead({
      tenancy: auth.tenancy,
      api_key_id: params.api_key_id,
    });
  },
}));
