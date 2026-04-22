import { validateSafeFetchUrl } from "@/lib/safe-fetch";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";

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
    const discoveryUrl = `${stripTrailingSlash(trimmed)}/.well-known/openid-configuration`;
    const safe = await validateSafeFetchUrl(discoveryUrl);
    if (safe.kind !== "ok") {
      return { statusCode: 200, bodyType: "json" as const, body: { error: safe.reason } };
    }

    try {
      const response = await fetch(safe.url.toString(), {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return { statusCode: 200, bodyType: "json" as const, body: { error: "discovery failed" } };
      }
      const doc = await response.json() as { issuer?: unknown, jwks_uri?: unknown };
      if (typeof doc.issuer !== "string" || typeof doc.jwks_uri !== "string") {
        return { statusCode: 200, bodyType: "json" as const, body: { error: "discovery doc is missing `issuer` or `jwks_uri`" } };
      }
      return {
        statusCode: 200,
        bodyType: "json" as const,
        body: { ok: { issuer: doc.issuer, jwks_uri: doc.jwks_uri } },
      };
    } catch (e) {
      captureError("oidc-federation-probe-discovery-failed", { url: safe.url.toString(), error: e });
      return { statusCode: 200, bodyType: "json" as const, body: { error: "discovery failed" } };
    }
  },
});
