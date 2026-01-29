import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { KeyIntersect } from "@stackframe/stack-shared/dist/utils/types";
import { createSignUpRuleContext } from "./cel-evaluator";
import { evaluateAndApplySignUpRules, logRuleTrigger } from "./sign-up-rules";
import { Tenancy } from "./tenancies";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";

/**
 * Options for sign-up rule evaluation context.
 */
export type SignUpRuleOptions = {
  authMethod: 'password' | 'otp' | 'oauth' | 'passkey',
  oauthProvider?: string,
};

/**
 * Creates or upgrades an anonymous user with sign-up rule evaluation.
 *
 * This function evaluates sign-up rules before creating/upgrading the user.
 * Use this for all signup paths:
 * - Password signup
 * - OTP signup
 * - OAuth signup
 * - Passkey signup
 * - Anonymous user conversion
 *
 * Do NOT use this for creating anonymous users (use createOrUpgradeAnonymousUser directly).
 *
 * @param tenancy - The tenancy context
 * @param currentUser - Current user (if any, for anonymous upgrade)
 * @param createOrUpdate - User creation/update data
 * @param allowedErrorTypes - Error types to allow
 * @param signUpRuleOptions - Options for sign-up rule evaluation
 * @returns Created or updated user
 * @throws KnownErrors.SignUpRejected if a sign-up rule rejects the signup
 */
export async function createOrUpgradeAnonymousUserWithRules(
  tenancy: Tenancy,
  currentUser: UsersCrud["Admin"]["Read"] | null,
  createOrUpdate: KeyIntersect<UsersCrud["Admin"]["Create"], UsersCrud["Admin"]["Update"]>,
  allowedErrorTypes: (new (...args: any) => any)[],
  signUpRuleOptions: SignUpRuleOptions,
): Promise<UsersCrud["Admin"]["Read"]> {
  // Get email from create/update data
  // TypeScript doesn't know this field exists due to KeyIntersect, but it's always passed for signup
  const email = (createOrUpdate as { primary_email?: string }).primary_email
    ?? throwErr("primary_email is required for signup rule evaluation");

  // Create context for rule evaluation
  const context = createSignUpRuleContext({
    email,
    authMethod: signUpRuleOptions.authMethod,
    oauthProvider: signUpRuleOptions.oauthProvider,
  });

  // Evaluate and apply sign-up rules (may throw if rejected)
  const ruleResult = await evaluateAndApplySignUpRules(tenancy, context);

  // Build metadata objects for each target from sign-up rule metadata
  let clientMetadata: Record<string, unknown> | undefined;
  let clientReadOnlyMetadata: Record<string, unknown> | undefined;
  let serverMetadata: Record<string, unknown> | undefined;

  if (ruleResult.metadata) {
    for (const [key, entry] of Object.entries(ruleResult.metadata)) {
      switch (entry.target) {
        case 'client': {
          clientMetadata = { ...clientMetadata, [key]: entry.value };
          break;
        }
        case 'client_read_only': {
          clientReadOnlyMetadata = { ...clientReadOnlyMetadata, [key]: entry.value };
          break;
        }
        case 'server': {
          serverMetadata = { ...serverMetadata, [key]: entry.value };
          break;
        }
      }
    }
  }

  // Merge sign-up rule data into createOrUpdate
  // Use type assertion as we know the structure from UsersCrud
  const createOrUpdateWithMeta = createOrUpdate as Record<string, unknown>;

  // Build the private restriction details if shouldRestrict is true
  // The public reason is left empty - admins can set it manually if they want to show something to the user
  const restrictionPrivateDetails = ruleResult.shouldRestrict && ruleResult.ruleId
    ? `Restricted by sign-up rule: ${ruleResult.ruleId}`
    : ruleResult.shouldRestrict
      ? 'Restricted by sign-up rules'
      : undefined;

  const enrichedCreateOrUpdate = {
    ...createOrUpdate,
    // Merge client_metadata (sign-up rule metadata overwrites existing keys)
    ...(clientMetadata && {
      client_metadata: {
        ...(createOrUpdateWithMeta.client_metadata as Record<string, unknown> | undefined),
        ...clientMetadata,
      },
    }),
    // Merge client_read_only_metadata
    ...(clientReadOnlyMetadata && {
      client_read_only_metadata: {
        ...(createOrUpdateWithMeta.client_read_only_metadata as Record<string, unknown> | undefined),
        ...clientReadOnlyMetadata,
      },
    }),
    // Merge server_metadata
    ...(serverMetadata && {
      server_metadata: {
        ...(createOrUpdateWithMeta.server_metadata as Record<string, unknown> | undefined),
        ...serverMetadata,
      },
    }),
    // Handle shouldRestrict by setting restricted_by_admin fields
    // Note: reason (public) is left null, private_details contains the rule info
    ...(ruleResult.shouldRestrict && {
      restricted_by_admin: true,
      restricted_by_admin_private_details: restrictionPrivateDetails,
    }),
  };

  // Proceed with user creation/upgrade
  const user = await createOrUpgradeAnonymousUser(
    tenancy,
    currentUser,
    enrichedCreateOrUpdate as KeyIntersect<UsersCrud["Admin"]["Create"], UsersCrud["Admin"]["Update"]>,
    allowedErrorTypes,
  );

  if (ruleResult.ruleId) {
    runAsynchronously(logRuleTrigger(tenancy.id, ruleResult.ruleId, context, ruleResult.action, user.id));
  }

  return user;
}

/**
 * Creates or upgrades an anonymous user WITHOUT sign-up rule evaluation.
 *
 * Use this only for:
 * - Creating anonymous users (no rules apply)
 * - Internal operations where rules should be bypassed
 *
 * For all signup paths, use createOrUpgradeAnonymousUserWithRules instead.
 */
export async function createOrUpgradeAnonymousUser(
  tenancy: Tenancy,
  currentUser: UsersCrud["Admin"]["Read"] | null,
  createOrUpdate: KeyIntersect<UsersCrud["Admin"]["Create"], UsersCrud["Admin"]["Update"]>,
  allowedErrorTypes: (new (...args: any) => any)[],
): Promise<UsersCrud["Admin"]["Read"]> {
  if (currentUser?.is_anonymous) {
    // Upgrade anonymous user
    return await usersCrudHandlers.adminUpdate({
      tenancy,
      user_id: currentUser.id,
      data: {
        ...createOrUpdate,
        is_anonymous: false,
      },
      allowedErrorTypes,
    });
  } else {
    // Create new user (normal flow)
    return await usersCrudHandlers.adminCreate({
      tenancy,
      data: createOrUpdate,
      allowedErrorTypes,
    });
  }
}
