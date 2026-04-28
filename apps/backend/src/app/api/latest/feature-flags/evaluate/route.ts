import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { evaluateFlag, evaluateFlags, findFlagIdByKey } from "@stackframe/stack-shared/dist/feature-flags/evaluator";
import type { EvalContext, EvalResult, FeatureFlagsConfig } from "@stackframe/stack-shared/dist/feature-flags/types";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupBoolean, yupMixed, yupNumber, yupObject, yupRecord, yupString } from "@stackframe/stack-shared/dist/schema-fields";

const evalResultSchema = yupObject({
  flag_key: yupString().defined(),
  variant_key: yupString().nullable().defined(),
  value: yupMixed(),
  reason: yupString().defined(),
  rule_id: yupString().nullable().defined(),
});

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Evaluate feature flags for a given context",
    description: "Resolves feature flag variants for a user/team/anonymous context. Definitions are read from the project's branch+environment config; evaluation is deterministic and matches the SDK's local evaluator byte-for-byte.",
    tags: ["Feature Flags"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
      user: adaptSchema.optional(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
    body: yupObject({
      // Caller-provided distinct identifier for sticky bucketing. If omitted we fall back to
      // auth.user.id so authenticated callers get a stable bucket without any extra wiring.
      distinct_id: yupString().optional(),
      user_id: yupString().optional(),
      team_id: yupString().optional(),
      user: yupRecord(yupString(), yupMixed()).optional(),
      team: yupRecord(yupString(), yupMixed()).optional(),
      context: yupRecord(yupString(), yupMixed()).optional(),
      cohorts: yupRecord(yupString(), yupBoolean().defined()).optional(),
      // Subset of flag keys to evaluate. If omitted, every flag in the tenancy config is evaluated.
      flag_keys: yupArray(yupString().defined()).optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      results: yupRecord(yupString(), evalResultSchema).defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    const config: FeatureFlagsConfig = auth.tenancy.config.featureFlags;

    const callerCanSupplyTargetingContext = auth.type !== "client";
    const evalContext: EvalContext = callerCanSupplyTargetingContext ? {
      distinctId: body.distinct_id ?? body.user_id ?? auth.user?.id,
      userId: body.user_id ?? auth.user?.id,
      teamId: body.team_id,
      user: body.user,
      team: body.team,
      context: body.context,
      cohorts: body.cohorts,
    } : {
      distinctId: body.distinct_id ?? auth.user?.id,
      userId: auth.user?.id,
      user: auth.user ? {
        id: auth.user.id,
        primary_email: auth.user.primary_email,
        primary_email_verified: auth.user.primary_email_verified,
        email: auth.user.primary_email,
      } : undefined,
    };

    const results = new Map<string, ReturnType<typeof shape>>();
    if (body.flag_keys) {
      for (const requestedKey of body.flag_keys) {
        const flagId = findFlagIdByKey(config, requestedKey);
        const result = flagId === undefined
          ? { flagKey: requestedKey, variantKey: undefined, value: undefined, reason: "missing" } satisfies EvalResult
          : evaluateFlag(flagId, config, evalContext);
        results.set(requestedKey, shape(requestedKey, result));
      }
    } else {
      const evaluated = evaluateFlags(config, evalContext);
      for (const [id, result] of Object.entries(evaluated)) {
        const flagDef = config.flags?.[id];
        const userKey = flagDef?.key ?? id;
        results.set(userKey, shape(userKey, result));
      }
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: { results: Object.fromEntries(results) },
    };
  },
});

function shape(flagKey: string, result: EvalResult) {
  return {
    flag_key: flagKey,
    variant_key: result.variantKey ?? null,
    value: result.value,
    reason: result.reason,
    rule_id: result.ruleId ?? null,
  };
}
