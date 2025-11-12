import { CrudTypeOf, createCrud } from "../../crud";
import { yupObject, yupString } from "../../schema-fields";

export const svixTokenAdminReadSchema = yupObject({
  token: yupString().defined(),
  url: yupString().optional(),
}).defined();

export const svixTokenAdminCreateSchema = yupObject({}).defined();

export const svixTokenCrud = createCrud({
  adminReadSchema: svixTokenAdminReadSchema,
  adminCreateSchema: svixTokenAdminCreateSchema,
  docs: {
    adminCreate: {
      hidden: true,
    },
  }
});
export type SvixTokenCrud = CrudTypeOf<typeof svixTokenCrud>;
