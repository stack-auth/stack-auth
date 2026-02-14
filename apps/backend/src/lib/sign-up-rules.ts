import { runAsynchronouslyAndWaitUntil } from "@/utils/vercel";
import type { SignUpRule, SignUpRuleAction } from "@stackframe/stack-shared/dist/interface/crud/sign-up-rules";
import { captureError, StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { CelEvaluationError, evaluateCelExpression, SignUpRuleContext } from "./cel-evaluator";
import { logEvent, SystemEventTypes } from "./events";
import { Tenancy } from "./tenancies";

/**
 * Logs a sign-up rule trigger as a ClickHouse event for analytics.
 * This runs asynchronously and doesn't block the signup flow.
 */
async function logRuleTrigger(
  tenancy: Tenancy,
  ruleId: string,
  context: SignUpRuleContext,
  action: SignUpRuleAction,
): Promise<void> {
  try {
    await logEvent([SystemEventTypes.SignUpRuleTrigger], {
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      ruleId,
      action: action.type,
      email: context.email,
      authMethod: context.authMethod,
      oauthProvider: context.oauthProvider,
    });
  } catch (e) {
    // Don't fail the signup if logging fails
    captureError(`sign-up-rule-trigger-log-error`, new StackAssertionError(`Failed to log sign-up rule trigger for rule ${ruleId}`, { cause: e }));
  }
}

/**
 * Evaluates all sign-up rules for a tenancy against the given context.
 * Rules are evaluated in order of priority (highest first), then alphabetically by ID.
 * Returns the first matching rule's action, or the default action if no rules match.
 *
 * This function should be called from all signup paths:
 * - Password signup
 * - OTP signup
 * - OAuth signup
 * - Passkey signup
 * - Anonymous user conversion (when anonymous user adds email/auth method)
 *
 * This function should NOT be called when creating anonymous users.
 *
 * @param tenancy - The tenancy to evaluate rules for
 * @param context - The signup context with email, authMethod, etc.
 * @returns The rule result with action to take
 */
export async function evaluateSignUpRules(
  tenancy: Tenancy,
  context: SignUpRuleContext
) {
  const result = evaluateSignUpRulesInternal(tenancy, context, { includeEvaluations: false, logTriggers: true });
  return {
    restrictedBecauseOfSignUpRuleId: result.outcome.restrictedBecauseOfSignUpRuleId,
    shouldAllow: result.outcome.shouldAllow,
  };
}

export type SignUpRuleEvaluationStatus =
  | 'matched'
  | 'not_matched'
  | 'disabled'
  | 'missing_condition'
  | 'error';

export type SignUpRuleEvaluation = {
  ruleId: string,
  rule: SignUpRule,
  status: SignUpRuleEvaluationStatus,
  error?: string,
};

export type SignUpRulesTraceResult = {
  evaluations: SignUpRuleEvaluation[],
  outcome: {
    shouldAllow: boolean,
    decision: 'allow' | 'reject' | 'default-allow' | 'default-reject',
    decisionRuleId: string | null,
    restrictedBecauseOfSignUpRuleId: string | null,
  },
};

/**
 * Evaluates all sign-up rules and returns a trace of evaluations.
 * This is used for admin testing and does not log any analytics events.
 */
export function evaluateSignUpRulesWithTrace(
  tenancy: Tenancy,
  context: SignUpRuleContext
): SignUpRulesTraceResult {
  return evaluateSignUpRulesInternal(tenancy, context, { includeEvaluations: true, logTriggers: false });
}

function evaluateSignUpRulesInternal(
  tenancy: Tenancy,
  context: SignUpRuleContext,
  options: { includeEvaluations: boolean, logTriggers: boolean }
): SignUpRulesTraceResult {
  const config = tenancy.config;
  const evaluations: SignUpRuleEvaluation[] = [];
  let restrictedBecauseOfSignUpRuleId: string | null = null;

  const recordEvaluation = options.includeEvaluations
    ? (evaluation: SignUpRuleEvaluation) => {
      evaluations.push(evaluation);
    }
    : () => {};

  for (const [ruleId, rule] of typedEntries(config.auth.signUpRules)) {
    const isEnabled = rule.enabled === true;
    if (!isEnabled) {
      recordEvaluation({
        ruleId,
        rule,
        status: 'disabled',
      });
      continue;
    }
    if (!rule.condition) {
      recordEvaluation({
        ruleId,
        rule,
        status: 'missing_condition',
      });
      continue;
    }

    let matches = false;
    let status: SignUpRuleEvaluationStatus = 'not_matched';
    let error: string | undefined;
    try {
      matches = evaluateCelExpression(rule.condition, context);
      status = matches ? 'matched' : 'not_matched';
    } catch (e) {
      if (e instanceof CelEvaluationError) {
        status = 'error';
        error = e.message;
        // technically a custom config could cause this, but the dashboard shouldn't allow creating faulty configs
        // so for now, let's capture an error so we know that something is probably wrong on the DB
        captureError(`cel-evaluation-error:${ruleId}`, new StackAssertionError(`CEL evaluation error for rule ${ruleId}`, { cause: e }));
      } else {
        throw e;
      }
    }

    recordEvaluation({
      ruleId,
      rule,
      status,
      ...(error ? { error } : {}),
    });

    if (matches) {
      const actionConfig = rule.action;
      const actionType = actionConfig.type;
      const action: SignUpRuleAction = {
        type: actionType,
        message: actionConfig.message,
      };

      if (options.logTriggers) {
        // log asynchronously
        runAsynchronouslyAndWaitUntil(logRuleTrigger(tenancy, ruleId, context, action));
      }

      // apply the action
      if (actionType === 'restrict') {
        // Only record the first restrict rule (highest priority)
        if (restrictedBecauseOfSignUpRuleId === null) {
          restrictedBecauseOfSignUpRuleId = ruleId;
        }
      }
      if (actionType === 'allow' || actionType === 'reject') {
        return {
          evaluations,
          outcome: {
            restrictedBecauseOfSignUpRuleId,
            shouldAllow: actionType === 'allow',
            decision: actionType,
            decisionRuleId: ruleId,
          },
        };
      }
    }
  }

  const shouldAllow = config.auth.signUpRulesDefaultAction !== 'reject';
  return {
    evaluations,
    outcome: {
      restrictedBecauseOfSignUpRuleId,
      shouldAllow,
      decision: shouldAllow ? 'default-allow' : 'default-reject',
      decisionRuleId: null,
    },
  };
}
