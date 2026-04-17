import { rewriteTemplateSourceWithAI } from "@/lib/email-template-rewrite";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Rewrite email template source for email draft creation",
    description: "Rewrites email template TSX into standalone draft TSX using AI and runtime validation.",
    hidden: true,
    tags: ["Internal", "AI"],
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
      tsx_source: yupString().defined(),
    }).defined(),
  }),
  handler: async ({ body }) => {
    const rewriteResult = await rewriteTemplateSourceWithAI(body.template_tsx_source);
    if (rewriteResult.status === "error") {
      throw new KnownErrors.TemplateSourceRewriteError(rewriteResult.error);
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        tsx_source: rewriteResult.data,
      },
    };
  },
});
