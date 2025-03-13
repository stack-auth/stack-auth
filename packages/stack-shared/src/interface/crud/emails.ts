import { createCrud, CrudTypeOf } from "../../crud";
import * as fieldSchema from "../../schema-fields";
import { emailConfigWithoutPasswordSchema } from "./projects";


export const sentEmailReadSchema = fieldSchema.yupObject({
  id: fieldSchema.yupString().defined(),
  subject: fieldSchema.yupString().defined(),
  sent_at_millis: fieldSchema.yupNumber().defined(),
  to: fieldSchema.yupArray(fieldSchema.yupString().defined()),
  sender_config: emailConfigWithoutPasswordSchema.defined(),
  error: fieldSchema.yupMixed().nullable().optional(),
}).defined();

export const internalEmailsCrud = createCrud({
  adminReadSchema: sentEmailReadSchema,
});

export type InternalEmailsCrud = CrudTypeOf<typeof internalEmailsCrud>;
