import { createCrud, CrudTypeOf } from "../../crud";
import * as schemaFields from "../../schema-fields";
import { yupObject } from "../../schema-fields";

const emailConfigSchema = yupObject({
  type: schemaFields.emailTypeSchema.defined(),
  host: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailHostSchema, {
    type: 'standard',
  }),
  port: schemaFields.yupDefinedWhen(schemaFields.emailPortSchema, {
    type: 'standard',
  }),
  username: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailUsernameSchema, {
    type: 'standard',
  }),
  sender_name: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailSenderNameSchema, {
    type: 'standard',
  }),
  sender_email: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailSenderEmailSchema, {
    type: 'standard',
  }),
});

export const sentEmailReadSchema = yupObject({
  id: schemaFields.yupString().defined(),
  subject: schemaFields.yupString().defined(),
  sent_at_millis: schemaFields.yupNumber().defined(),
  to: schemaFields.yupArray(schemaFields.yupString().defined()),
  sender_config: emailConfigSchema.defined(),
  error: schemaFields.yupMixed().nullable().optional(),
}).defined();

export const internalEmailsCrud = createCrud({
  adminReadSchema: sentEmailReadSchema,
});

export type InternalEmailsCrud = CrudTypeOf<typeof internalEmailsCrud>;
