import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

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
    let discoveryUrl: string;
    try {
      discoveryUrl = `${stripTrailingSlash(trimmed)}/.well-known/openid-configuration`;
      new URL(discoveryUrl);
    } catch {
      return { statusCode: 200, bodyType: "json" as const, body: { error: "issuer URL is not a valid URL" } };
    }

    try {
      const response = await fetch(discoveryUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return { statusCode: 200, bodyType: "json" as const, body: { error: `HTTP ${response.status} from ${discoveryUrl}` } };
      }
      const doc = await response.json() as { issuer?: unknown, jwks_uri?: unknown };
      if (typeof doc.issuer !== "string") {
        return { statusCode: 200, bodyType: "json" as const, body: { error: "discovery doc missing `issuer`" } };
      }
      if (typeof doc.jwks_uri !== "string") {
        return { statusCode: 200, bodyType: "json" as const, body: { error: "discovery doc missing `jwks_uri`" } };
      }
      return {
        statusCode: 200,
        bodyType: "json" as const,
        body: { ok: { issuer: doc.issuer, jwks_uri: doc.jwks_uri } },
      };
    } catch (e) {
      return { statusCode: 200, bodyType: "json" as const, body: { error: e instanceof Error ? e.message : String(e) } };
    }
  },
});
