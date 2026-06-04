
//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY, INSTEAD EDIT THE CORRESPONDING FILE IN packages/template
//===========================================
import { EmailTemplateCrud, EmailTemplateType } from "@hexclave/shared/dist/interface/crud/email-templates";


export type AdminEmailTemplate = {
  type: EmailTemplateType,
  subject: string,
  content: any,
  isDefault: boolean,
}

export type AdminEmailTemplateUpdateOptions = {
  subject?: string,
  content?: any,
};
export function adminEmailTemplateUpdateOptionsToCrud(options: AdminEmailTemplateUpdateOptions): EmailTemplateCrud['Admin']['Update'] {
  return {
    subject: options.subject,
    content: options.content,
  };
}
