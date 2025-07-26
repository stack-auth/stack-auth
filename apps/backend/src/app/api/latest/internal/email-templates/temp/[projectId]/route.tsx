import { overrideEnvironmentConfigOverride } from "@/lib/config";
import { renderEmailWithTemplate } from "@/lib/email-rendering";
import { DEFAULT_BRANCH_ID } from "@/lib/tenancies";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { EmailTemplate, EmailTemplateType } from "@prisma/client";
import { EMAIL_TEMPLATES_METADATA, EmailTemplateMetadata } from "@stackframe/stack-emails/dist/utils";
import { DEFAULT_EMAIL_TEMPLATES } from "@stackframe/stack-shared/dist/helpers/emails";
import { adaptSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { deindent, typedToLowercase } from "@stackframe/stack-shared/dist/utils/strings";
import { getTransformedTemplateMetadata } from "../convert";

const emptyThemeComponent = deindent`
  import { Html, Head, Body } from "@react-email/components";
  export function EmailTheme({ children }: { children: React.ReactNode }) {
    return (
      <Html>
        <Head></Head>
        <Body>
          {children}
        </Body>
      </Html>
    );
  }
`;

const prismaEmailTemplateToConfigTemplateId = (prismaTemplate: EmailTemplate) => {
  const templateType = prismaTemplate.type;
  const getConfigTemplateIdByDisplayName = (displayName: (typeof DEFAULT_EMAIL_TEMPLATES)[keyof typeof DEFAULT_EMAIL_TEMPLATES]["displayName"]) => {
    return Object.entries(DEFAULT_EMAIL_TEMPLATES).find(([_, value]) => value.displayName === displayName)?.[0];
  };
  switch (templateType) {
    case EmailTemplateType.EMAIL_VERIFICATION: {
      return getConfigTemplateIdByDisplayName("Email Verification");
    }
    case EmailTemplateType.PASSWORD_RESET: {
      return getConfigTemplateIdByDisplayName("Password Reset");
    }
    case EmailTemplateType.MAGIC_LINK: {
      return getConfigTemplateIdByDisplayName("Magic Link/OTP");
    }
    case EmailTemplateType.TEAM_INVITATION: {
      return getConfigTemplateIdByDisplayName("Team Invitation");
    }
    case EmailTemplateType.SIGN_IN_INVITATION: {
      return getConfigTemplateIdByDisplayName("Sign In Invitation");
    }
    default: {
      return null;
    }
  }
};

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      projectId: yupString().uuid().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      templates_converted: yupNumber().defined(),
      total_templates: yupNumber().defined(),
      rendered: yupArray(yupObject({
        legacy_template_content: yupMixed(),
        template_type: yupString().defined(),
        rendered_html: yupString().nullable().defined(),
      }).defined()).defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, params: { projectId } }) {
    if (tenancy.project.id !== "internal") {
      throw new StatusError(StatusError.Forbidden, "This endpoint is not available");
    }

    const project = await globalPrismaClient.project.findFirst({
      where: { id: projectId },
    });
    if (!project) {
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          templates_converted: 0,
          total_templates: 0,
          rendered: [],
        },
      };
    }

    const dbTemplates = await globalPrismaClient.emailTemplate.findMany({
      where: {
        projectId,
      },
    });

    const emailTemplates: Record<string, ReturnType<typeof getTransformedTemplateMetadata>> = {};
    const rendered = [];
    for (const template of dbTemplates) {
      const configTemplateId = prismaEmailTemplateToConfigTemplateId(template);
      if (!configTemplateId) {
        continue;
      }
      const defaultTemplateMetadata = EMAIL_TEMPLATES_METADATA[typedToLowercase(template.type)];
      const templateMetadata = {
        ...defaultTemplateMetadata,
        defaultContent: {
          [2]: template.content,
        },
      };
      emailTemplates[configTemplateId] = getTransformedTemplateMetadata(templateMetadata as unknown as EmailTemplateMetadata);
      const renderedTemplate = await renderEmailWithTemplate(
        emailTemplates[configTemplateId].tsxSource,
        emptyThemeComponent,
        {
          project: { displayName: project.displayName },
          user: { displayName: "John Doe" },
          previewMode: true,
        }
      );
      rendered.push({
        legacy_template_content: template.content,
        template_type: template.type,
        rendered_html: renderedTemplate.status === "ok" ? renderedTemplate.data.html : null,
      });
    }


    await overrideEnvironmentConfigOverride({
      tx: globalPrismaClient,
      projectId,
      branchId: DEFAULT_BRANCH_ID,
      environmentConfigOverrideOverride: {
        "emails.templates": emailTemplates,
      },
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        templates_converted: Object.keys(emailTemplates).length,
        total_templates: dbTemplates.length,
        rendered,
      },
    };
  },
});


export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      project_ids: yupArray(yupString().defined()).defined(),
    }).defined(),
  }).defined(),
  async handler({ auth: { tenancy } }) {
    if (tenancy.project.id !== "internal") {
      throw new StatusError(StatusError.Forbidden, "This endpoint is not available");
    }

    const dbTemplates = await globalPrismaClient.emailTemplate.findMany({
      where: {
        projectId: {
          not: "internal",
        },
      },
      select: {
        projectId: true,
      },
    });
    const projectIds = [...new Set(dbTemplates.map((template) => template.projectId))];

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        project_ids: projectIds,
      },
    };
  },
});
