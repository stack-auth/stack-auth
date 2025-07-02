import { CrudTypeOf, createCrud } from "../../crud";
import { jsonSchema, yupBoolean, yupMixed, yupObject, yupString } from "../../schema-fields";

export type EmailTemplateType = typeof emailTemplateTypes[number];
export const emailTemplateTypes = ['email_verification', 'password_reset', 'magic_link', 'team_invitation', 'sign_in_invitation'] as const;

export const emailTemplateAdminReadSchema = yupObject({
  type: yupString().oneOf(emailTemplateTypes).defined(),
  subject: yupString().defined(),
  content: jsonSchema.defined(),
  is_default: yupBoolean().defined(),
}).defined();

export const emailTemplateCrudAdminUpdateSchema = yupObject({
  content: jsonSchema.nonNullable().optional(),
  subject: yupString().optional(),
}).defined();

export const emailTemplateCrudAdminDeleteSchema = yupMixed();

export const emailTemplateCrudAdminCreateSchema = yupObject({
  type: yupString().oneOf(emailTemplateTypes).defined(),
  content: jsonSchema.defined(),
  subject: yupString().defined(),
}).defined();

export const emailTemplateCrud = createCrud({
  adminReadSchema: emailTemplateAdminReadSchema,
  adminUpdateSchema: emailTemplateCrudAdminUpdateSchema,
  adminCreateSchema: emailTemplateCrudAdminCreateSchema,
  adminDeleteSchema: emailTemplateCrudAdminDeleteSchema,
  docs: {
    adminRead: {
      hidden: true,
    },
    adminCreate: {
      hidden: true,
    },
    adminUpdate: {
      hidden: true,
    },
    adminDelete: {
      hidden: true,
    },
    adminList: {
      hidden: true,
    }
  }
});
export type EmailTemplateCrud = CrudTypeOf<typeof emailTemplateCrud>;
