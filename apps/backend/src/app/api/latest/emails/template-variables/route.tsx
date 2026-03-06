import { extractTemplateVariables } from "@/lib/email-rendering";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, jsonSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Extract template variables",
    description: "Extracts variable names, types, and default values from a template's variablesSchema using the arktype module system.",
    tags: ["Emails"],
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      template_tsx_source: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      variables: yupArray(yupObject({
        name: yupString().defined(),
        type: yupString().defined(),
        default_value: jsonSchema.defined(),
      }).defined()).defined(),
    }).defined(),
  }),
  handler: async ({ body }) => {
    const result = await extractTemplateVariables(body.template_tsx_source);

    if (result.status === "error") {
      throw new KnownErrors.TemplateVariableExtractionError(result.error);
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        variables: result.data.map(v => ({ name: v.name, type: v.type, default_value: v.defaultValue })),
      },
    };
  },
});
