import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import type { SmartResponse } from "@/route-handlers/smart-response";
import { _internal as hashingInternal } from "@stackframe/stack-shared/dist/feature-flags/hashing";
import type { FeatureFlagsConfig, FlagDef } from "@stackframe/stack-shared/dist/feature-flags/types";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupMixed, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";

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
  response: yupMixed<SmartResponse>().defined(),
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
      return {
        statusCode: 304,
        bodyType: "binary",
        body: new Uint8Array(),
        headers: {
          "content-type": ["application/json; charset=utf-8"],
          etag: [etag],
        },
      };
    }

    const body = {
      flags: flagsById,
      flag_ids_by_key: flagIdsByKey,
      holdouts,
      version,
    };
    return {
      statusCode: 200,
      bodyType: "binary",
      body: new TextEncoder().encode(JSON.stringify(body)),
      headers: {
        "content-type": ["application/json; charset=utf-8"],
        etag: [etag],
      },
    };
  },
});
