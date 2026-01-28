import { KnownErrors } from "@stackframe/stack-shared";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { evaluateCelExpression, SignupRuleContext } from "./cel-evaluator";
import { Tenancy } from "./tenancies";
import { globalPrismaClient } from "@/prisma-client";

/**
 * Metadata entry with value and target for where it should be stored.
 */
export type SignupRuleMetadataEntry = {
  value: string | number | boolean,
  target: 'client' | 'client_read_only' | 'server',
};

/**
 * The action to take when a signup rule matches.
 */
export type SignupRuleAction = {
  type: 'allow' | 'reject' | 'restrict' | 'log' | 'add_metadata',
  metadata?: Record<string, SignupRuleMetadataEntry>,
  message?: string,
};

/**
 * A signup rule from the config.
 * Type definition for the signupRules field in auth config.
 */
type SignupRuleConfig = {
  enabled?: boolean,
  displayName?: string,
  priority?: number,
  condition?: string,
  action?: {
    type?: 'allow' | 'reject' | 'restrict' | 'log' | 'add_metadata',
    message?: string,
    metadata?: Record<string, SignupRuleMetadataEntry>,
  },
};

/**
 * Extended auth config type that includes signup rules.
 * Used for type assertions since the schema types may not be updated yet.
 */
type AuthConfigWithSignupRules = {
  signupRules?: Record<string, SignupRuleConfig>,
  signupRulesDefaultAction?: 'allow' | 'reject',
};

/**
 * Result of evaluating signup rules.
 */
export type SignupRuleResult = {
  /** The rule ID that matched, or null if no rules matched (using default action) */
  ruleId: string | null,
  /** The action to take */
  action: SignupRuleAction,
};

/**
 * Logs a signup rule trigger to the database for analytics.
 * This runs asynchronously and doesn't block the signup flow.
 */
async function logRuleTrigger(
  tenancyId: string,
  ruleId: string,
  context: SignupRuleContext,
  action: SignupRuleAction,
  userId?: string
): Promise<void> {
  try {
    await globalPrismaClient.signupRuleTrigger.create({
      data: {
        tenancyId,
        ruleId,
        userId,
        action: action.type,
        metadata: {
          email: context.email,
          emailDomain: context.emailDomain,
          authMethod: context.authMethod,
          oauthProvider: context.oauthProvider,
        },
      },
    });
  } catch (e) {
    // Don't fail the signup if logging fails
    console.error('Failed to log signup rule trigger:', e);
  }
}

/**
 * Evaluates all signup rules for a tenancy against the given context.
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
export async function evaluateSignupRules(
  tenancy: Tenancy,
  context: SignupRuleContext
): Promise<SignupRuleResult> {
  const config = tenancy.config;
  // Type assertion for signup rules fields that may not be in the generated types yet
  const authConfig = config.auth as typeof config.auth & AuthConfigWithSignupRules;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- TypeScript may not see these as optional due to type assertion
  const rules = authConfig.signupRules ?? {} as Record<string, SignupRuleConfig>;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- TypeScript may not see these as optional due to type assertion
  const defaultActionType = authConfig.signupRulesDefaultAction ?? 'allow';

  // Get all enabled rules and sort by priority (ascending), then by ID (alphabetically)
  const sortedRuleEntries = Object.entries(rules)
    .filter(([, rule]) => rule.enabled)
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
        const action: SignupRuleAction = {
          type: rule.action.type,
          metadata: rule.action.metadata,
          message: rule.action.message,
        };

        // Log rule trigger to database for analytics (async, don't await)
        // The userId will be set later after user creation if successful
        runAsynchronously(logRuleTrigger(tenancy.id, ruleId, context, action));

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
 * Applies the signup rule result action.
 * This should be called after evaluateSignupRules to handle the action.
 *
 * @param result - The result from evaluateSignupRules
 * @throws KnownErrors.SignUpRejected if action is 'reject'
 */
export function applySignupRuleAction(result: SignupRuleResult): {
  shouldRestrict: boolean,
  metadata?: Record<string, SignupRuleMetadataEntry>,
} {
  switch (result.action.type) {
    case 'reject': {
      // Throw an error to reject the signup
      // Don't include the custom rule message to avoid helping users evade rules
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
      // The logging is already done in evaluateSignupRules
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
 * Combined function to evaluate and apply signup rules.
 * This is the main entry point for signup rule evaluation.
 *
 * @param tenancy - The tenancy to evaluate rules for
 * @param context - The signup context with email, authMethod, etc.
 * @returns Object with shouldRestrict, optional metadata, and ruleId that triggered
 * @throws KnownErrors.SignUpRejected if a rule rejects the signup
 */
export async function evaluateAndApplySignupRules(
  tenancy: Tenancy,
  context: SignupRuleContext
): Promise<{
  shouldRestrict: boolean,
  metadata?: Record<string, SignupRuleMetadataEntry>,
  ruleId: string | null,
}> {
  const result = await evaluateSignupRules(tenancy, context);
  const applied = applySignupRuleAction(result);
  return {
    ...applied,
    ruleId: result.ruleId,
  };
}
