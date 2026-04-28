import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { _internal as hashingInternal } from "@stackframe/stack-shared/dist/feature-flags/hashing";
import type { FeatureFlagsConfig, FlagDef } from "@stackframe/stack-shared/dist/feature-flags/types";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

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
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      flags: yupMixed().defined(),
      // Maps developer-facing flag keys to the opaque config ids used by evaluator references.
      flag_ids_by_key: yupMixed().defined(),
      holdouts: yupMixed().defined(),
      // Bumped whenever the rendered config changes; SDKs use it as an ETag for polling.
      version: yupString().defined(),
    }).defined(),
  }),
  handler: async ({ auth }) => {
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
    const version = hashingInternal.murmur3_32(JSON.stringify({ flags: flagsById, flagIdsByKey, holdouts })).toString(16);

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        flags: flagsById,
        flag_ids_by_key: flagIdsByKey,
        holdouts,
        version,
      },
    };
  },
});
