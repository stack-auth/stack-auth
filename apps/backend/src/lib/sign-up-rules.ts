import { globalPrismaClient } from "@/prisma-client";
import { KnownErrors } from "@stackframe/stack-shared";
import type { SignUpRule, SignUpRuleAction, SignUpRuleMetadataEntry } from "@stackframe/stack-shared/dist/interface/crud/sign-up-rules";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { evaluateCelExpression, SignUpRuleContext } from "./cel-evaluator";
import { Tenancy } from "./tenancies";

/**
 * Extended auth config type that includes sign-up rules.
 * Used for type assertions since the schema types may not be updated yet.
 */
type AuthConfigWithSignUpRules = {
  signUpRules?: Record<string, SignUpRule>,
  signUpRulesDefaultAction?: 'allow' | 'reject',
};

/**
 * Result of evaluating sign-up rules.
 */
export type SignUpRuleResult = {
  /** The rule ID that matched, or null if no rules matched (using default action) */
  ruleId: string | null,
  /** The action to take */
  action: SignUpRuleAction,
};

/**
 * Logs a sign-up rule trigger to the database for analytics.
 * This runs asynchronously and doesn't block the signup flow.
 */
export async function logRuleTrigger(
  tenancyId: string,
  ruleId: string,
  context: SignUpRuleContext,
  action: SignUpRuleAction,
  userId?: string
): Promise<void> {
  try {
    const normalizedEmail = context.email.trim().toLowerCase();
    const normalizedDomain = context.emailDomain.trim().toLowerCase();

    await globalPrismaClient.signupRuleTrigger.create({
      data: {
        tenancyId,
        ruleId,
        userId,
        action: action.type,
        metadata: {
          email: normalizedEmail,
          emailDomain: normalizedDomain || null,
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
): Promise<SignUpRuleResult> {
  const config = tenancy.config;
  // Type assertion for sign-up rules fields that may not be in the generated types yet
  const authConfig = config.auth as typeof config.auth & AuthConfigWithSignUpRules;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- TypeScript may not see these as optional due to type assertion
  const rules = authConfig.signUpRules ?? {} as Record<string, SignUpRule>;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- TypeScript may not see these as optional due to type assertion
  const defaultActionType = authConfig.signUpRulesDefaultAction ?? 'allow';

  // Get all enabled rules and sort by priority (ascending), then by ID (alphabetically)
  const sortedRuleEntries = Object.entries(rules)
    .filter(([, rule]) => rule.enabled !== false)
    .sort((a, b) => {
      const priorityA = a[1].priority;
      const priorityB = b[1].priority;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return stringCompare(a[0], b[0]);
    });

  // Evaluate each rule in order
  for (const [ruleId, rule] of sortedRuleEntries) {
    if (!rule.condition) continue;

    try {
      const matches = evaluateCelExpression(rule.condition, context);
      if (matches) {
        const actionConfig = rule.action;
        const actionType = actionConfig.type;
        const action: SignUpRuleAction = {
          type: actionType,
          metadata: actionConfig.metadata,
          message: actionConfig.message,
        };

        if (action.type === 'reject') {
          // Log rule trigger to database for analytics (async, don't await)
          runAsynchronously(logRuleTrigger(tenancy.id, ruleId, context, action));
        }

        return {
          ruleId,
          action,
        };
      }
    } catch (e) {
      // Log CEL evaluation error but continue to next rule
      console.error(`CEL evaluation error for rule ${ruleId}:`, e);
    }
  }

  // No rules matched - return default action
  return {
    ruleId: null,
    action: { type: defaultActionType },
  };
}

/**
 * Applies the sign-up rule result action.
 * This should be called after evaluateSignUpRules to handle the action.
 *
 * @param result - The result from evaluateSignUpRules
 * @throws KnownErrors.SignUpRejected if action is 'reject'
 */
export function applySignUpRuleAction(result: SignUpRuleResult): {
  shouldRestrict: boolean,
  metadata?: Record<string, SignUpRuleMetadataEntry>,
} {
  switch (result.action.type) {
    case 'reject': {
      // Throw an error to reject the signup
      // Note: We intentionally don't pass the custom message to avoid helping users evade rules
      // The custom message is only for internal logging/analytics purposes
      throw new KnownErrors.SignUpRejected();
    }
    case 'restrict': {
      // Mark user as restricted (will need to be handled in user creation)
      return { shouldRestrict: true };
    }
    case 'add_metadata': {
      // Return metadata to be added to the user
      return { shouldRestrict: false, metadata: result.action.metadata };
    }
    case 'log': {
      // Just log, don't restrict or reject
      return { shouldRestrict: false };
    }
    case 'allow':
    default: {
      // Allow the signup to proceed normally
      return { shouldRestrict: false };
    }
  }
}

/**
 * Combined function to evaluate and apply sign-up rules.
 * This is the main entry point for sign-up rule evaluation.
 *
 * @param tenancy - The tenancy to evaluate rules for
 * @param context - The signup context with email, authMethod, etc.
 * @returns Object with shouldRestrict, optional metadata, ruleId, and action
 * @throws KnownErrors.SignUpRejected if a rule rejects the signup
 */
export async function evaluateAndApplySignUpRules(
  tenancy: Tenancy,
  context: SignUpRuleContext
): Promise<{
  shouldRestrict: boolean,
  metadata?: Record<string, SignUpRuleMetadataEntry>,
  ruleId: string | null,
  action: SignUpRuleAction,
}> {
  const result = await evaluateSignUpRules(tenancy, context);
  const applied = applySignUpRuleAction(result);
  return {
    ...applied,
    ruleId: result.ruleId,
    action: result.action,
  };
}
