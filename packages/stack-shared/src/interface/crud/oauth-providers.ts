import { CrudTypeOf, createCrud } from "../../crud";
import {
  oauthProviderAccountIdSchema,
  oauthProviderAllowConnectedAccountsSchema,
  oauthProviderAllowSignInSchema,
  oauthProviderEmailSchema,
  oauthProviderIdSchema,
  oauthProviderTypeSchema,
  userIdOrMeSchema,
  yupMixed,
  yupObject,
  yupString
} from "../../schema-fields";

export const oauthProviderClientReadSchema = yupObject({
  user_id: userIdOrMeSchema.defined(),
  id: oauthProviderIdSchema.defined(),
  email: oauthProviderEmailSchema.optional(),
  type: oauthProviderTypeSchema.defined(),
  allow_sign_in: oauthProviderAllowSignInSchema.defined(),
  allow_connected_accounts: oauthProviderAllowConnectedAccountsSchema.defined(),
}).defined();

export const oauthProviderServerReadSchema = oauthProviderClientReadSchema.concat(yupObject({
  account_id: oauthProviderAccountIdSchema.defined(),
}));

export const oauthProviderCrudClientUpdateSchema = yupObject({
  allow_sign_in: oauthProviderAllowSignInSchema.optional(),
  allow_connected_accounts: oauthProviderAllowConnectedAccountsSchema.optional(),
}).defined();

export const oauthProviderCrudServerUpdateSchema = oauthProviderCrudClientUpdateSchema.concat(yupObject({
  email: oauthProviderEmailSchema.optional(),
  account_id: oauthProviderAccountIdSchema.optional(),
}));

export const oauthProviderCrudServerCreateSchema = yupObject({
  user_id: userIdOrMeSchema.defined(),
  provider_config_id: yupString().defined(),
  email: oauthProviderEmailSchema.optional(),
  allow_sign_in: oauthProviderAllowSignInSchema.defined(),
  allow_connected_accounts: oauthProviderAllowConnectedAccountsSchema.defined(),
  account_id: oauthProviderAccountIdSchema.defined(),
}).defined();

export const oauthProviderCrudClientDeleteSchema = yupMixed();

export const oauthProviderCrud = createCrud({
  clientReadSchema: oauthProviderClientReadSchema,
  clientUpdateSchema: oauthProviderCrudClientUpdateSchema,
  clientDeleteSchema: oauthProviderCrudClientDeleteSchema,
  serverReadSchema: oauthProviderServerReadSchema,
  serverUpdateSchema: oauthProviderCrudServerUpdateSchema,
  serverCreateSchema: oauthProviderCrudServerCreateSchema,
  docs: {
    clientRead: {
      summary: "Get an OAuth provider",
      description: "Retrieves a specific OAuth provider by the user ID and the OAuth provider ID.",
      tags: ["OAuth Providers"],
    },
    serverCreate: {
      summary: "Create an OAuth provider",
      description: "Add a new OAuth provider for a user.",
      tags: ["OAuth Providers"],
    },
    serverUpdate: {
      summary: "Update an OAuth provider",
      description: "Updates an existing OAuth provider. Only the values provided will be updated.",
      tags: ["OAuth Providers"],
    },
    clientDelete: {
      summary: "Delete an OAuth provider",
      description: "Removes an OAuth provider for a given user.",
      tags: ["OAuth Providers"],
    },
    clientList: {
      summary: "List OAuth providers",
      description: "Retrieves a list of all OAuth providers for a user.",
      tags: ["OAuth Providers"],
    },
  }
});
export type OAuthProviderCrud = CrudTypeOf<typeof oauthProviderCrud>;
