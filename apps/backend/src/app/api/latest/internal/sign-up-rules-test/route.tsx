import { createSignUpRuleContext } from "@/lib/cel-evaluator";
import { evaluateSignUpRulesWithTrace } from "@/lib/sign-up-rules";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

const AUTH_METHODS = ['password', 'otp', 'oauth', 'passkey'] as const;
const ACTION_TYPES = ['allow', 'reject', 'restrict', 'log'] as const;
const DECISION_TYPES = ['allow', 'reject', 'default-allow', 'default-reject'] as const;
const STATUS_TYPES = ['matched', 'not_matched', 'disabled', 'missing_condition', 'error'] as const;

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
    body: yupObject({
      email: yupString().optional(),
      auth_method: yupString().oneOf(AUTH_METHODS).defined(),
      oauth_provider: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      context: yupObject({
        email: yupString().defined(),
        email_domain: yupString().defined(),
        auth_method: yupString().oneOf(AUTH_METHODS).defined(),
        oauth_provider: yupString().defined(),
      }).defined(),
      evaluations: yupArray(yupObject({
        rule_id: yupString().defined(),
        display_name: yupString().defined(),
        enabled: yupBoolean().defined(),
        condition: yupString().defined(),
        status: yupString().oneOf(STATUS_TYPES).defined(),
        action: yupObject({
          type: yupString().oneOf(ACTION_TYPES).defined(),
          message: yupString().optional(),
        }).defined(),
        error: yupString().optional(),
      }).defined()).defined(),
      outcome: yupObject({
        should_allow: yupBoolean().defined(),
        decision: yupString().oneOf(DECISION_TYPES).defined(),
        decision_rule_id: yupString().nullable().defined(),
        restricted_because_of_rule_id: yupString().nullable().defined(),
      }).defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const context = createSignUpRuleContext({
      email: req.body.email,
      authMethod: req.body.auth_method,
      oauthProvider: req.body.oauth_provider,
    });
    const trace = evaluateSignUpRulesWithTrace(req.auth.tenancy, context);

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {
        context: {
          email: context.email,
          email_domain: context.emailDomain,
          auth_method: context.authMethod,
          oauth_provider: context.oauthProvider,
        },
        evaluations: trace.evaluations.map((evaluation) => ({
          rule_id: evaluation.ruleId,
          display_name: evaluation.rule.displayName ?? "",
          enabled: evaluation.rule.enabled !== false,
          condition: evaluation.rule.condition ?? "",
          status: evaluation.status,
          action: {
            type: evaluation.rule.action.type,
            message: evaluation.rule.action.message,
          },
          ...(evaluation.error ? { error: evaluation.error } : {}),
        })),
        outcome: {
          should_allow: trace.outcome.shouldAllow,
          decision: trace.outcome.decision,
          decision_rule_id: trace.outcome.decisionRuleId,
          restricted_because_of_rule_id: trace.outcome.restrictedBecauseOfSignUpRuleId,
        },
      },
    };
  },
});
