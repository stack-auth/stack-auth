import { CrudTypeOf, createCrud } from "../../crud";
import { yupBoolean, yupMixed, yupNumber, yupObject, yupString } from "../../schema-fields";

const basePublicApiKeysReadSchema = yupObject({
  id: yupString().defined(),
  description: yupString().optional(),
  expires_at_millis: yupNumber().optional(),
  manually_revoked_at_millis: yupNumber().optional(),
  created_at_millis: yupNumber().defined(),
  team_id: yupString().optional(),
  tenancy_id: yupString().optional(),
  project_user_id: yupString().optional(),
});

// Used for the result of the create endpoint
export const publicApiKeysCreateInputSchema = yupObject({
  description: yupString().optional(),
  expires_at_millis: yupNumber().optional(),
  team_id: yupString().optional(),
  tenancy_id: yupString().optional(),
  project_user_id: yupString().optional(),
});

export const publicApiKeysCreateOutputSchema = basePublicApiKeysReadSchema.concat(yupObject({
  secret_api_key: yupString().optional(),
}).defined());


// Used for list, read and update endpoints after the initial creation
export const publicApiKeysObfuscatedReadSchema = basePublicApiKeysReadSchema.concat(yupObject({
  secret_api_key: yupObject({
    last_four: yupString().defined(),
  }).optional(),
}));

export const combinedPublicApiKeysReadSchema = basePublicApiKeysReadSchema.concat(yupObject({
  secret_api_key: yupMixed(),
}));

export const publicApiKeysUpdateSchema = yupObject({
  description: yupString().optional(),
  revoked: yupBoolean().oneOf([true]).optional(),
}).defined();


export const publicApiKeysDeleteSchema = yupMixed();

export const publicApiKeysCrud = createCrud({
  // Also adding client schemas to allow client-side access
  clientCreateSchema: publicApiKeysCreateInputSchema,
  clientReadSchema: combinedPublicApiKeysReadSchema,
  clientUpdateSchema: publicApiKeysUpdateSchema,
  clientDeleteSchema: publicApiKeysDeleteSchema,
  docs: {
    clientCreate: {
      description: "Create a new API key",
      displayName: "Create API Key",
      summary: "Create API key",
    },
    clientList: {
      description: "List all API keys for the project",
      displayName: "List API Keys",
      summary: "List API keys",
    },
    clientRead: {
      description: "Get details of a specific API key",
      displayName: "Get API Key",
      summary: "Get API key details",
    },
    clientUpdate: {
      description: "Update an API key",
      displayName: "Update API Key",
      summary: "Update API key",
    },
    clientDelete: {
      description: "Delete an API key",
      displayName: "Delete API Key",
      summary: "Delete API key",
    },
  },
});

export type PublicApiKeysCrud = CrudTypeOf<typeof publicApiKeysCrud>;
