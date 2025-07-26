import { overrideEnvironmentConfigOverride } from "@/lib/config";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { renderEmailWithTemplate } from "@/lib/email-rendering";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";


export const PATCH = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      templateId: yupString().uuid().defined(),
    }).defined(),
    body: yupObject({
      tsx_source: yupString().defined(),
      theme_id: yupString().uuid().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      rendered_html: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, params: { templateId }, body }) {
    const templateList = tenancy.completeConfig.emails.templates;
    if (!Object.keys(templateList).includes(templateId)) {
      throw new StatusError(StatusError.NotFound, "No template found with given id");
    }
    const theme = tenancy.completeConfig.emails.themes[tenancy.completeConfig.emails.selectedThemeId];
    const result = await renderEmailWithTemplate(body.tsx_source, theme.tsxSource, {
      variables: { projectDisplayName: tenancy.project.display_name },
      previewMode: true,
    });
    if (result.status === "error") {
      throw new KnownErrors.EmailRenderingError(result.error);
    }
    if (result.data.subject === undefined) {
      throw new KnownErrors.EmailRenderingError("Subject is required, import it from @stackframe/emails");
    }
    if (result.data.notificationCategory === undefined) {
      throw new KnownErrors.EmailRenderingError("NotificationCategory is required, import it from @stackframe/emails");
    }

    await overrideEnvironmentConfigOverride({
      tx: globalPrismaClient,
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      environmentConfigOverrideOverride: {
        [`emails.templates.${templateId}.tsxSource`]: body.tsx_source,
        [`emails.templates.${templateId}.themeId`]: body.theme_id,
      },
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        rendered_html: result.data.html,
      },
    };
  },
});
