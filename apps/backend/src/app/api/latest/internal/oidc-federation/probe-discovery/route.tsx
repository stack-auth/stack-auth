import { fetchOidcDiscoveryDocument } from "@/lib/oidc-jwt";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      issuer_url: yupString().defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      ok: yupObject({
        issuer: yupString().defined(),
        jwks_uri: yupString().defined(),
      }).optional(),
      error: yupString().optional(),
    }).defined(),
  }),
  handler: async ({ body }) => {
    const trimmed = body.issuer_url.trim();
    if (!trimmed) {
      return { statusCode: 200, bodyType: "json" as const, body: { error: "issuer URL is empty" } };
    }
    try {
      const doc = await fetchOidcDiscoveryDocument(trimmed);
      return {
        statusCode: 200,
        bodyType: "json" as const,
        body: { ok: { issuer: doc.issuer, jwks_uri: doc.jwks_uri } },
      };
    } catch (e) {
      captureError("oidc-federation-probe-discovery-failed", { issuerUrl: trimmed, error: e });
      const message = e instanceof Error ? e.message : "discovery failed";
      return { statusCode: 200, bodyType: "json" as const, body: { error: message } };
    }
  },
});
