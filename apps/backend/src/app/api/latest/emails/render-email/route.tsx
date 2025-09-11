import { getEmailThemeForTemplate, renderEmailWithTemplate } from "@/lib/email-rendering";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { adaptSchema, templateThemeIdSchema, yupNumber, yupObject, yupString, yupUnion } from "@stackframe/stack-shared/dist/schema-fields";
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
    body: yupUnion(
      yupObject({
        template_id: yupString().uuid().defined(),
        theme_id: templateThemeIdSchema,
      }),
      yupObject({
        template_id: yupString().uuid().defined(),
        theme_tsx_source: yupString().defined(),
      }),
      yupObject({
        template_tsx_source: yupString().defined(),
        theme_id: templateThemeIdSchema,
      }),
      yupObject({
        template_tsx_source: yupString().defined(),
        theme_tsx_source: yupString().defined(),
      }),
    ).defined(),
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
    const templateList = new Map(Object.entries(tenancy.config.emails.templates));
    const themeList = new Map(Object.entries(tenancy.config.emails.themes));
    let themeSource: string;
    if ("theme_tsx_source" in body) {
      themeSource = body.theme_tsx_source;
    } else {
      if (typeof body.theme_id === "string" && !themeList.has(body.theme_id)) {
        throw new StatusError(400, "No theme found with given id");
      }
      themeSource = getEmailThemeForTemplate(tenancy, body.theme_id);
    }

    let contentSource: string;
    if ("template_tsx_source" in body) {
      contentSource = body.template_tsx_source;
    } else if ("template_id" in body) {
      const template = templateList.get(body.template_id);
      if (!template) {
        throw new StatusError(400, "No template found with given id");
      }
      contentSource = template.tsxSource;
    } else {
      throw new KnownErrors.SchemaError("Either template_id or template_tsx_source must be provided");
    }

    const result = await renderEmailWithTemplate(
      contentSource,
      themeSource,
      {
        project: { displayName: tenancy.project.display_name },
        previewMode: true,
      },
    );
    if (result.status === "error") {
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
