import { CrudTypeOf, createCrud } from "../../crud";
import {
  oauthProviderAccountIdSchema,
  oauthProviderProviderConfigIdSchema,
  userIdOrMeSchema,
  yupObject,
  yupString
} from "../../schema-fields";

// Connected Account CRUD (for listing/reading connected accounts)
export const connectedAccountClientReadSchema = yupObject({
  user_id: userIdOrMeSchema.defined(),
  provider: oauthProviderProviderConfigIdSchema.defined(),
  provider_account_id: oauthProviderAccountIdSchema.defined(),
}).defined();

export const connectedAccountCrud = createCrud({
  clientReadSchema: connectedAccountClientReadSchema,
  docs: {
    clientRead: {
      summary: "Get a connected account",
      description: "Retrieves a specific connected account by the user ID and provider account ID.",
      tags: ["Connected Accounts"],
    },
    clientList: {
      summary: "List connected accounts",
      description: "Retrieves a list of all connected accounts for a user.",
      tags: ["Connected Accounts"],
    },
  },
});
export type ConnectedAccountCrud = CrudTypeOf<typeof connectedAccountCrud>;

// Connected Account Access Token CRUD (for getting access tokens)
export const connectedAccountAccessTokenReadSchema = yupObject({
  access_token: yupString().defined(),
}).defined();

export const connectedAccountAccessTokenCreateSchema = yupObject({
  scope: yupString().optional(),
}).defined();

export const connectedAccountAccessTokenCrud = createCrud({
  clientReadSchema: connectedAccountAccessTokenReadSchema,
  clientCreateSchema: connectedAccountAccessTokenCreateSchema,
  docs: {
    clientCreate: {
      hidden: true,
    }
  },
});
export type ConnectedAccountAccessTokenCrud = CrudTypeOf<typeof connectedAccountAccessTokenCrud>;
