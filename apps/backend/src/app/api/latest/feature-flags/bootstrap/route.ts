import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import type { SmartResponse } from "@/route-handlers/smart-response";
import { _internal as hashingInternal } from "@stackframe/stack-shared/dist/feature-flags/hashing";
import type { FeatureFlagsConfig, FlagDef } from "@stackframe/stack-shared/dist/feature-flags/types";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupString, yupUnion } from "@stackframe/stack-shared/dist/schema-fields";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import type { Schema } from "yup";

function deepSortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepSortKeys);
  if (value == null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => stringCompare(a, b))
      .map(([key, nestedValue]) => [key, deepSortKeys(nestedValue)]),
  );
}

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Bootstrap feature flag definitions for SDK local evaluation",
    description: "Returns the full set of feature flag definitions for the resolved tenancy. Clients cache the payload and evaluate locally; the server's evaluator and the SDK's evaluator are byte-identical.",
    tags: ["Feature Flags"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    headers: yupObject({
      "if-none-match": yupArray(yupString().defined()).optional(),
    }).defined(),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupUnion(
    yupObject({
      statusCode: yupNumber().oneOf([200]).defined(),
      bodyType: yupString().oneOf(["binary"]).defined(),
      body: yupMixed<Uint8Array>().defined(),
      headers: yupObject({
        "content-type": yupArray(yupString().defined()).defined(),
        etag: yupArray(yupString().defined()).defined(),
      }).defined(),
    }).defined(),
    yupObject({
      statusCode: yupNumber().oneOf([304]).defined(),
      bodyType: yupString().oneOf(["empty"]).defined(),
      headers: yupObject({
        etag: yupArray(yupString().defined()).defined(),
      }).defined(),
    }).defined(),
  ) as unknown as Schema<SmartResponse>,
  handler: async ({ auth, headers }) => {
    const config: FeatureFlagsConfig = auth.tenancy.config.featureFlags;
    const flagsById: Record<string, Omit<FlagDef, "ownerUserId">> = {};
    const flagIdsByKey: Record<string, string> = {};
    for (const [id, def] of Object.entries(config.flags ?? {})) {
      if (!def?.key) continue;
      // ownerUserId is operator-facing metadata, never needed for evaluation. Strip it from the
      // bootstrap payload so we don't leak admin user ids to client SDKs.
      const { ownerUserId: _ownerUserId, ...rest } = def;
      flagsById[id] = rest;
      flagIdsByKey[def.key] = id;
    }

    const holdouts = config.holdouts ?? {};
    // Stable content-addressed version: SDKs hit this endpoint with `If-None-Match: <version>` and
    // we (eventually) 304 when nothing changed. Using murmur3 keeps this fast enough to recompute
    // per request without caching.
    const versionPayload = deepSortKeys({ flags: flagsById, flagIdsByKey, holdouts });
    const version = hashingInternal.murmur3_32(JSON.stringify(versionPayload)).toString(16);
    const etag = `"${version}"`;

    if (headers["if-none-match"]?.includes(etag) || headers["if-none-match"]?.includes(version)) {
      const responseHeaders: Record<string, string[]> = {
        etag: [etag],
      };
      return {
        statusCode: 304,
        bodyType: "empty",
        headers: responseHeaders,
      };
    }

    const body = {
      flags: flagsById,
      flag_ids_by_key: flagIdsByKey,
      holdouts,
      version,
    };
    const responseHeaders: Record<string, string[]> = {
      "content-type": ["application/json; charset=utf-8"],
      etag: [etag],
    };
    return {
      statusCode: 200,
      bodyType: "binary",
      body: new TextEncoder().encode(JSON.stringify(body)),
      headers: responseHeaders,
    };
  },
});
