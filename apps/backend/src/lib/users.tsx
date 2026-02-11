import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import { KnownErrors } from "@stackframe/stack-shared";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { KeyIntersect } from "@stackframe/stack-shared/dist/utils/types";
import { createSignUpRuleContext } from "./cel-evaluator";
import { evaluateSignUpRules } from "./sign-up-rules";
import { Tenancy } from "./tenancies";

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
 * Do NOT use this for creating anonymous users (use createOrUpgradeAnonymousUserWithoutRules directly).
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
  const email = createOrUpdate.primary_email ?? currentUser?.primary_email ?? undefined;
  const ruleResult = await evaluateSignUpRules(tenancy, createSignUpRuleContext({
    email,
    authMethod: signUpRuleOptions.authMethod,
    oauthProvider: signUpRuleOptions.oauthProvider,
  }));

  if (!ruleResult.shouldAllow) {
    throw new KnownErrors.SignUpRejected();
  }

  const existingRestrictionPrivateDetails = createOrUpdate.restricted_by_admin_private_details ?? currentUser?.restricted_by_admin_private_details;
  const restrictionRuleId = ruleResult.restrictedBecauseOfSignUpRuleId;
  const restrictionRuleDisplayName = restrictionRuleId
    ? (tenancy.config.auth.signUpRules[restrictionRuleId].displayName ?? "")
    : "";
  const restrictionPrivateDetails = restrictionRuleId
    ? `Restricted by sign-up rule: ${restrictionRuleId}${restrictionRuleDisplayName ? ` (${restrictionRuleDisplayName})` : ""}`
    : undefined;

  const enrichedCreateOrUpdate = {
    ...createOrUpdate,
    ...!!ruleResult.restrictedBecauseOfSignUpRuleId ? {
      restricted_by_admin: true,
      restricted_by_admin_private_details: existingRestrictionPrivateDetails ? `${existingRestrictionPrivateDetails}\n\n${restrictionPrivateDetails}` : restrictionPrivateDetails,
    } : {},
  };

  // Proceed with user creation/upgrade
  const user = await createOrUpgradeAnonymousUserWithoutRules(
    tenancy,
    currentUser,
    enrichedCreateOrUpdate as KeyIntersect<UsersCrud["Admin"]["Create"], UsersCrud["Admin"]["Update"]>,
    allowedErrorTypes,
  );

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
export async function createOrUpgradeAnonymousUserWithoutRules(
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
