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
        description: `Create a new ${type} API key`,
        displayName: `Create ${type} API key`,
        tags: ["API Keys"],
        summary: `Create ${type} API key`,
      },
      clientList: {
        description: `List all ${type} API keys for the project with their metadata and status`,
        displayName: `List ${type} API keys`,
        summary: `List ${type} API keys`,
        tags: ["API Keys"],
      },
      clientRead: {
        description: `Get details of a specific ${type} API key`,
        displayName: `Get ${type} API key`,
        summary: `Get ${type} API key details`,
        tags: ["API Keys"],
      },
      clientUpdate: {
        description: `Update an ${type} API key`,
        displayName: `Update ${type} API key`,
        summary: `Update ${type} API key`,
        tags: ["API Keys"],
      },
      serverDelete: {
        description: `Delete an ${type} API key`,
        displayName: `Delete ${type} API key`,
        summary: `Delete ${type} API key`,
        tags: ["API Keys"],
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
