import { CrudTypeOf, createCrud } from "../../crud";
import { yupObject, yupString } from "../../schema-fields";

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
