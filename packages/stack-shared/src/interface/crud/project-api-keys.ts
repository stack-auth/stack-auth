import { CrudTypeOf, createCrud } from "../../crud";
import { yupBoolean, yupMixed, yupNumber, yupObject, yupString } from "../../schema-fields";

const baseProjectApiKeysReadSchema = yupObject({
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
export const projectApiKeysCreateInputSchema = yupObject({
  description: yupString().optional(),
  expires_at_millis: yupNumber().optional(),
  team_id: yupString().optional(),
  tenancy_id: yupString().optional(),
  project_user_id: yupString().optional(),
});

export const projectApiKeysCreateOutputSchema = baseProjectApiKeysReadSchema.concat(yupObject({
  secret_api_key: yupString().optional(),
}).defined());


// Used for list, read and update endpoints after the initial creation
export const projectApiKeysObfuscatedReadSchema = baseProjectApiKeysReadSchema.concat(yupObject({
  secret_api_key: yupObject({
    last_four: yupString().defined(),
  }).optional(),
}));

export const combinedProjectApiKeysReadSchema = baseProjectApiKeysReadSchema.concat(yupObject({
  secret_api_key: yupMixed(),
}));

export const projectApiKeysUpdateSchema = yupObject({
  description: yupString().optional(),
  revoked: yupBoolean().oneOf([true]).optional(),
}).defined();


export const projectApiKeysDeleteSchema = yupMixed();

export const projectApiKeysCrud = createCrud({
  // Also adding client schemas to allow client-side access
  clientCreateSchema: projectApiKeysCreateInputSchema,
  clientReadSchema: combinedProjectApiKeysReadSchema,
  clientUpdateSchema: projectApiKeysUpdateSchema,
  clientDeleteSchema: projectApiKeysDeleteSchema,
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

export type ProjectApiKeysCrud = CrudTypeOf<typeof projectApiKeysCrud>;
