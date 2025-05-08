import { getEmailTemplate } from "@/lib/emails";
import { globalPrismaClient } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { Prisma } from "@prisma/client";
import { EMAIL_TEMPLATES_METADATA, validateEmailTemplateContent } from "@stackframe/stack-emails/dist/utils";
import { emailTemplateCrud, emailTemplateTypes } from "@stackframe/stack-shared/dist/interface/crud/email-templates";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { typedToLowercase, typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";

const CURRENT_VERSION = 2;

function prismaToCrud(prisma: Prisma.EmailTemplateGetPayload<{}>, isDefault: boolean) {
  return {
    subject: prisma.subject,
    content: prisma.content as any,
    type: typedToLowercase(prisma.type),
    is_default: isDefault,
  };
}

export const emailTemplateCrudHandlers = createLazyProxy(() => createCrudHandlers(emailTemplateCrud, {
  paramsSchema: yupObject({
    type: yupString().oneOf(emailTemplateTypes).defined(),
  }),
  async onRead({ params, auth }) {
    const dbType = typedToUppercase(params.type);
    const emailTemplate = await globalPrismaClient.emailTemplate.findUnique({
      where: {
        projectId_type: {
          projectId: auth.tenancy.project.id,
          type: dbType,
        },
      },
    });

    if (emailTemplate) {
      return prismaToCrud(emailTemplate, false);
    } else {
      return {
        type: params.type,
        content: EMAIL_TEMPLATES_METADATA[params.type].defaultContent[CURRENT_VERSION],
        subject: EMAIL_TEMPLATES_METADATA[params.type].defaultSubject,
        is_default: true,
      };
    }
  },
  async onUpdate({ auth, data, params }) {
    if (auth.tenancy.config.email_config.type === 'shared') {
      throw new StatusError(StatusError.BadRequest, 'Cannot update email templates in shared email config. Set up a custom email config to update email templates.');
    }

    if (data.content && !validateEmailTemplateContent(data.content)) {
      throw new StatusError(StatusError.BadRequest, 'Invalid email template content');
    }
    const dbType = typedToUppercase(params.type);
    const oldTemplate = await globalPrismaClient.emailTemplate.findUnique({
      where: {
        projectId_type: {
          projectId: auth.tenancy.project.id,
          type: dbType,
        },
      },
    });

    const content = data.content || oldTemplate?.content || EMAIL_TEMPLATES_METADATA[params.type].defaultContent[CURRENT_VERSION];
    const subject = data.subject || oldTemplate?.subject || EMAIL_TEMPLATES_METADATA[params.type].defaultSubject;

    const db = await globalPrismaClient.emailTemplate.upsert({
      where: {
        projectId_type: {
          projectId: auth.tenancy.project.id,
          type: dbType,
        },
      },
      update: {
        content,
        subject,
      },
      create: {
        projectId: auth.tenancy.project.id,
        type: dbType,
        content,
        subject,
      },
    });

    return prismaToCrud(db, false);
  },
  async onDelete({ auth, params }) {
    const dbType = typedToUppercase(params.type);
    const emailTemplate = await getEmailTemplate(auth.tenancy.project.id, params.type);
    if (!emailTemplate) {
      throw new StatusError(StatusError.NotFound, 'Email template not found');
    }
    await globalPrismaClient.emailTemplate.delete({
      where: {
        projectId_type: {
          projectId: auth.tenancy.project.id,
          type: dbType,
        },
      },
    });
  },
  async onList({ auth }) {
    const templates = await globalPrismaClient.emailTemplate.findMany({
      where: {
        projectId: auth.tenancy.project.id,
      },
    });

    const result = [];
    for (const [type, metadata] of typedEntries(EMAIL_TEMPLATES_METADATA)) {
      if (templates.some((t) => typedToLowercase(t.type) === type)) {
        result.push(prismaToCrud(templates.find((t) => typedToLowercase(t.type) === type)!, false));
      } else {
        result.push({
          type: typedToLowercase(type),
          content: metadata.defaultContent[CURRENT_VERSION],
          subject: metadata.defaultSubject,
          is_default: true,
        });
      }
    }
    return {
      items: result,
      is_paginated: false,
    };
  }
}));
