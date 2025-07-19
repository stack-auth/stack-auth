import { overrideEnvironmentConfigOverride } from "@/lib/config";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { renderEmailWithTemplate } from "@/lib/email-themes";
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
    const templateList = tenancy.completeConfig.emails.templateList;
    if (!Object.keys(templateList).includes(templateId)) {
      throw new StatusError(StatusError.NotFound, "No template found with given id");
    }
    const template = templateList[templateId];
    const theme = tenancy.completeConfig.emails.themeList[tenancy.completeConfig.emails.theme];
    const result = await renderEmailWithTemplate(body.tsx_source, theme.tsxSource, { projectDisplayName: tenancy.project.display_name });
    if ("error" in result) {
      throw new KnownErrors.EmailRenderingError(result.error);
    }

    await overrideEnvironmentConfigOverride({
      tx: globalPrismaClient,
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      environmentConfigOverrideOverride: {
        [`emails.templateList.${templateId}.tsxSource`]: body.tsx_source,
      },
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        rendered_html: result.html,
      },
    };
  },
});
