import { globalPrismaClient } from "@/prisma-client";
import { runAsynchronouslyAndWaitUntil } from "@/utils/vercel";
import type { SignUpRuleAction } from "@stackframe/stack-shared/dist/interface/crud/sign-up-rules";
import { captureError, StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { CelEvaluationError, evaluateCelExpression, SignUpRuleContext } from "./cel-evaluator";
import { Tenancy } from "./tenancies";

/**
 * Logs a sign-up rule trigger to the database for analytics.
 * This runs asynchronously and doesn't block the signup flow.
 */
async function logRuleTrigger(
  tenancyId: string,
  ruleId: string,
  context: SignUpRuleContext,
  action: SignUpRuleAction,
  userId?: string
): Promise<void> {
  try {
    // Context is already normalized via createSignUpRuleContext
    await globalPrismaClient.signupRuleTrigger.create({
      data: {
        tenancyId,
        ruleId,
        userId,
        action: action.type,
        metadata: {
          email: context.email,
          emailDomain: context.emailDomain || null,
          authMethod: context.authMethod,
          oauthProvider: context.oauthProvider,
        },
      },
    });
  } catch (e) {
    // Don't fail the signup if logging fails
    console.error('Failed to log sign-up rule trigger:', e);
  }
}

/**
 * Evaluates all sign-up rules for a tenancy against the given context.
 * Rules are evaluated in order of priority (lowest first), then alphabetically by ID.
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
  const config = tenancy.config;

  let restrictedBecauseOfSignUpRuleId: string | null = null;
  for (const [ruleId, rule] of typedEntries(config.auth.signUpRules)) {
    if (!rule.condition) continue;

    let matches = false;
    try {
      matches = evaluateCelExpression(rule.condition, context);
    } catch (e) {
      if (e instanceof CelEvaluationError) {
        // technically a custom config could cause this, but the dashboard shouldn't allow creating faulty configs
        // so for now, let's capture an error so we know that something is probably wrong on the DB
        captureError(`cel-evaluation-error:${ruleId}`, new StackAssertionError(`CEL evaluation error for rule ${ruleId}`, { cause: e }));
      } else {
        throw e;
      }
    }

    if (matches) {
      const actionConfig = rule.action;
      const actionType = actionConfig.type;
      const action: SignUpRuleAction = {
        type: actionType,
        message: actionConfig.message,
      };

      // log asynchronously
      runAsynchronouslyAndWaitUntil(logRuleTrigger(tenancy.id, ruleId, context, action));

      // apply the action
      if (actionType === 'restrict') {
        restrictedBecauseOfSignUpRuleId = ruleId;
      }
      if (actionType === 'allow' || actionType === 'reject') {
        return {
          restrictedBecauseOfSignUpRuleId,
          shouldAllow: actionType === 'allow',
        };
      }
    }
  }

  return {
    restrictedBecauseOfSignUpRuleId,
    shouldAllow: config.auth.signUpRulesDefaultAction !== 'reject',
  };
}
