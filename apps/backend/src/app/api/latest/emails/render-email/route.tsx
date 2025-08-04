import { getEmailThemeForTemplate, renderEmailWithTemplate } from "@/lib/email-rendering";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { adaptSchema, templateThemeIdSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Render email theme",
    description: "Renders HTML content using the specified email theme",
    tags: ["Emails"],
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      theme_id: templateThemeIdSchema.nullable(),
      theme_tsx_source: yupString(),
      template_id: yupString(),
      template_tsx_source: yupString(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      html: yupString().defined(),
      subject: yupString(),
      notification_category: yupString(),
    }).defined(),
  }),
  async handler({ body, auth: { tenancy } }) {
    if ((body.theme_id === undefined && !body.theme_tsx_source) || (body.theme_id && body.theme_tsx_source)) {
      throw new StatusError(400, "Exactly one of theme_id or theme_tsx_source must be provided");
    }
    if ((!body.template_id && !body.template_tsx_source) || (body.template_id && body.template_tsx_source)) {
      throw new StatusError(400, "Exactly one of template_id or template_tsx_source must be provided");
    }
    if (body.theme_id && !(body.theme_id in tenancy.completeConfig.emails.themes)) {
      throw new StatusError(400, "No theme found with given id");
    }
    const templateList = new Map(Object.entries(tenancy.completeConfig.emails.templates));
    const themeSource = body.theme_id === undefined ? body.theme_tsx_source! : getEmailThemeForTemplate(tenancy, body.theme_id);
    const templateSource = body.template_id ? templateList.get(body.template_id)?.tsxSource : body.template_tsx_source;

    if (!templateSource) {
      throw new StatusError(400, "No template found with given id");
    }
    const result = await renderEmailWithTemplate(
      templateSource,
      themeSource,
      {
        project: { displayName: tenancy.project.display_name },
        previewMode: true,
      },
    );
    if ("error" in result) {
      throw new KnownErrors.EmailRenderingError(result.error);
    }
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        html: result.data.html,
        subject: result.data.subject,
        notification_category: result.data.notificationCategory,
      },
    };
  },
});
