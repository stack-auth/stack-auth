import { EmailTemplateCrud, EmailTemplateType } from "@stackframe/stack-shared/dist/interface/crud/email-templates";


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
