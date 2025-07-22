import { renderEmailWithTemplate, renderEmailWithTheme } from "@/lib/email-themes";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { adaptSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { captureError, StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";


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
      theme_id: yupString().defined(),
      preview_html: yupString(),
      template_id: yupString(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      html: yupString().defined(),
    }).defined(),
  }),
  async handler({ body, auth: { tenancy } }) {
    const themeList = tenancy.completeConfig.emails.themeList;
    const templateList = tenancy.completeConfig.emails.templateList;
    if (!Object.keys(themeList).includes(body.theme_id)) {
      throw new StatusError(400, "No theme found with given id");
    }
    if ((body.preview_html && body.template_id) || (!body.preview_html && !body.template_id)) {
      throw new StatusError(400, "Exactly one of preview_html or template_id must be provided");
    }
    if (body.template_id && !Object.keys(templateList).includes(body.template_id)) {
      throw new StatusError(400, "No template found with given id");
    }
    const theme = themeList[body.theme_id];
    let result;
    if (body.template_id) {
      const template = templateList[body.template_id];
      result = await renderEmailWithTemplate(template.tsxSource, theme.tsxSource, { projectDisplayName: tenancy.project.display_name });
    }
    else {
      result = await renderEmailWithTheme(body.preview_html!, theme.tsxSource);
    }
    if ("error" in result) {
      captureError('render-email', new StackAssertionError("Error rendering email with theme", { result }));
      throw new KnownErrors.EmailRenderingError(result.error);
    }
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        html: result.html,
      },
    };
  },
});
