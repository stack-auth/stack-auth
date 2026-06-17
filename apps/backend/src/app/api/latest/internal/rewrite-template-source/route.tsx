import { rewriteTemplateSourceWithAI } from "@/lib/email-template-rewrite";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { adaptSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

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
  handler: async ({ body }, fullReq) => {
    // Forward the caller's Hexclave/Stack auth headers so the inner AI call
    // (which is a fresh HTTP request to /ai/query/generate) is authenticated
    // and resolves to the authenticated model tier rather than falling back
    // to the unauthenticated one.
    const authHeadersMap = new Map<string, string>();
    for (const [key, value] of Object.entries(fullReq.headers)) {
      if (value == null) continue;
      const lower = key.toLowerCase();
      if (lower.startsWith("x-stack-") || lower.startsWith("x-hexclave-")) {
        authHeadersMap.set(key, value.join(","));
      }
    }
    const authHeaders: Record<string, string> = Object.fromEntries(authHeadersMap);

    const rewriteResult = await rewriteTemplateSourceWithAI(body.template_tsx_source, authHeaders);
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
