import { overrideEnvironmentConfigOverride } from "@/lib/config";
import { DEFAULT_BRANCH_ID } from "@/lib/tenancies";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { EmailTemplate, EmailTemplateType } from "@prisma/client";
import { EMAIL_TEMPLATES_METADATA, EmailTemplateMetadata } from "@stackframe/stack-emails/dist/utils";
import { DEFAULT_EMAIL_TEMPLATES } from "@stackframe/stack-shared/dist/helpers/emails";
import { adaptSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { typedToLowercase } from "@stackframe/stack-shared/dist/utils/strings";
import { getTransformedTemplateMetadata } from "../convert";

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
    }).defined(),
  }),
  async handler({ auth: { tenancy }, params: { projectId } }) {
    if (tenancy.project.id !== "internal") {
      throw new StatusError(StatusError.Forbidden, "This endpoint is not available");
    }
    const dbTemplates = await globalPrismaClient.emailTemplate.findMany({
      where: {
        projectId,
      },
    });

    const emailTemplates: Record<string, ReturnType<typeof getTransformedTemplateMetadata>> = {};
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
    }

    await overrideEnvironmentConfigOverride({
      tx: globalPrismaClient,
      projectId,
      branchId: DEFAULT_BRANCH_ID,
      environmentConfigOverrideOverride: {
        "emails.templateList": emailTemplates,
      },
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        templates_converted: Object.keys(emailTemplates).length,
        total_templates: dbTemplates.length,
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
    query: yupObject({
      cursor: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      project_ids: yupArray(yupString().defined()).defined(),
      next_cursor: yupString().nullable().defined(),
    }).defined(),
  }).defined(),
  async handler({ auth: { tenancy }, query: { cursor } }) {
    if (tenancy.project.id !== "internal") {
      throw new StatusError(StatusError.Forbidden, "This endpoint is not available");
    }

    const limit = 1000;
    const projects = await globalPrismaClient.project.findMany({
      where: {
        id: {
          not: "internal",
        },
      },
      select: {
        id: true,
      },
      orderBy: {
        id: "asc",
      },
      take: limit + 1, // Take one extra to check if there are more results
      ...(cursor && {
        cursor: {
          id: cursor,
        },
        skip: 1, // Skip the cursor item itself
      }),
    });

    const hasMore = projects.length > limit;
    const projectsToReturn = hasMore ? projects.slice(0, limit) : projects;
    const nextCursor = hasMore ? projectsToReturn[projectsToReturn.length - 1].id : null;

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        project_ids: projectsToReturn.map((project) => project.id),
        next_cursor: nextCursor,
      },
    };
  },
});
