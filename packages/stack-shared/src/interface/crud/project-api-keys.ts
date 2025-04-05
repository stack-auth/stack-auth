import * as yup from "yup";
import { CrudTypeOf, createCrud } from "../../crud";
import { userIdOrMeSchema, yupBoolean, yupNumber, yupObject, yupString } from "../../schema-fields";
import { typedFromEntries } from "../../utils/objects";

function createApiKeyCrud<T extends string, IdFieldName extends string, IdSchema extends yup.Schema<any>>(type: T, idFieldName: IdFieldName, idSchema: IdSchema) {
  const projectApiKeysReadSchema = yupObject({
    id: yupString().defined(),
    description: yupString().defined(),
    expires_at_millis: yupNumber().optional(),
    manually_revoked_at_millis: yupNumber().optional(),
    created_at_millis: yupNumber().defined(),
    is_public: yupBoolean().defined(),
    value: yupObject({
      last_four: yupString().defined(),
    }).defined(),
    type: yupString().oneOf([type]).defined(),
    ...typedFromEntries([[idFieldName, idSchema]]),
  });

  const projectApiKeysUpdateSchema = yupObject({
    description: yupString().optional(),
    revoked: yupBoolean().oneOf([true]).optional(),
  }).defined();

  const projectApiKeysCrud = createCrud({
    clientReadSchema: projectApiKeysReadSchema,
    clientUpdateSchema: projectApiKeysUpdateSchema,
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

  // Used for the result of the create endpoint
  const projectApiKeysCreateInputSchema = yupObject({
    description: yupString().defined(),
    expires_at_millis: yupNumber().nullable().defined(),
    is_public: yupBoolean().optional(),
    /*
    prefix: yupString().optional().nonEmpty().test("prefix", "Prefix must contain only alphanumeric characters and underscores", (value) => {
      if (!value) return true;
      return /^[a-zA-Z0-9_]+$/.test(value);
    }),
    */
    ...typedFromEntries([[idFieldName, idSchema]]),
  });
  const projectApiKeysCreateOutputSchema = projectApiKeysReadSchema.omit(["value"]).concat(yupObject({
    value: yupString().defined(),
  }));

  return {
    crud: projectApiKeysCrud,
    createInputSchema: projectApiKeysCreateInputSchema,
    createOutputSchema: projectApiKeysCreateOutputSchema,
  };
}


export const {
  crud: userApiKeysCrud,
  createInputSchema: userApiKeysCreateInputSchema,
  createOutputSchema: userApiKeysCreateOutputSchema,
} = createApiKeyCrud("user", "user_id", userIdOrMeSchema.defined());
export type UserApiKeysCrud = CrudTypeOf<typeof userApiKeysCrud>;

export const {
  crud: teamApiKeysCrud,
  createInputSchema: teamApiKeysCreateInputSchema,
  createOutputSchema: teamApiKeysCreateOutputSchema,
} = createApiKeyCrud("team", "team_id", yupString().defined());
export type TeamApiKeysCrud = CrudTypeOf<typeof teamApiKeysCrud>;
