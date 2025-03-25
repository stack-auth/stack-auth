import * as yup from 'yup';
import { CrudTypeOf, createCrud } from "../../crud";
import { yupBoolean, yupMixed, yupNumber, yupObject, yupString } from "../../schema-fields";


type CreateApiKeyCrudOptions<T extends yup.AnyObject> = {
  idSchema: yup.ObjectSchema<T>,
}

const createApiKeyCrud = <T extends Record<string, yup.Schema>>(options: T) => {

  const baseProjectApiKeysReadSchema = yupObject({
    id: yupString().defined(),
    user_id: yupString().optional(),
    team_id: yupString().optional(),
    description: yupString().optional(),
    expires_at_millis: yupNumber().optional(),
    manually_revoked_at_millis: yupNumber().optional(),
    created_at_millis: yupNumber().defined(),
    ...options,

  });

  // Used for the result of the create endpoint
  const projectApiKeysCreateInputSchema = yupObject({
    description: yupString().optional(),
    expires_at_millis: yupNumber().optional(),
    ...options,
  });

  const combinedProjectApiKeysReadSchema = baseProjectApiKeysReadSchema.concat(yupObject({
    secret_api_key: yupMixed(),
  }));

  const projectApiKeysUpdateSchema = yupObject({
    description: yupString().optional(),
    revoked: yupBoolean().oneOf([true]).optional(),
  }).defined();

  const projectApiKeysDeleteSchema = yupMixed();

  const projectApiKeysCrud = createCrud({
    // Also adding client schemas to allow client-side access
    clientCreateSchema: projectApiKeysCreateInputSchema,
    clientReadSchema: combinedProjectApiKeysReadSchema,
    clientUpdateSchema: projectApiKeysUpdateSchema,
    serverDeleteSchema: projectApiKeysDeleteSchema,
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
      serverDelete: {
        description: "Delete an API key",
        displayName: "Delete API Key",
        summary: "Delete API key",
      },
    },
  });

  return {
    crud: projectApiKeysCrud,
  };
};


const { crud: userApiKeysCrud } = createApiKeyCrud({
  user_id: yupString().optional(),
});

export { userApiKeysCrud };
export type UserApiKeysCrud = CrudTypeOf<typeof userApiKeysCrud>;

const { crud: teamApiKeysCrud } = createApiKeyCrud({
  team_id: yupString().optional(),
});

export { teamApiKeysCrud };
export type TeamApiKeysCrud = CrudTypeOf<typeof teamApiKeysCrud>;
