import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import { KnownErrors } from "@stackframe/stack-shared";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { KeyIntersect } from "@stackframe/stack-shared/dist/utils/types";
import { createSignUpRuleContext } from "./cel-evaluator";
import { getSpoofableEndUserIp, getSpoofableEndUserLocation } from "./end-users";
import { calculateSignUpRiskScores } from "./risk-scores";
import { evaluateSignUpRules } from "./sign-up-rules";
import { Tenancy } from "./tenancies";

/**
 * Options for sign-up rule evaluation context.
 */
export type SignUpRuleOptions = {
  authMethod: 'password' | 'otp' | 'oauth' | 'passkey',
  oauthProvider: string | null,
  ipAddress: string | null,
  countryCode: string | null,
};

function getStubSignUpCountryCode(email: string | null): string | null {
  if (email === null) {
    return null;
  }

  const match = email.match(/^([a-z]{2})-test@example\.com$/);
  return match === null ? null : match[1].toUpperCase();
}

export function getDerivedSignUpCountryCode(requestCountryCode: string | null, email: string | null): string | null {
  return requestCountryCode ?? getStubSignUpCountryCode(email);
}

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
  const email = createOrUpdate.primary_email ?? currentUser?.primary_email ?? null;
  const primaryEmailVerified = createOrUpdate.primary_email_verified ?? currentUser?.primary_email_verified ?? false;
  const [requestIpAddress, requestLocation] = await Promise.all([
    signUpRuleOptions.ipAddress !== null ? Promise.resolve(signUpRuleOptions.ipAddress) : getSpoofableEndUserIp().then((ip) => ip ?? null),
    signUpRuleOptions.countryCode !== null ? Promise.resolve(null) : getSpoofableEndUserLocation(),
  ]);
  const countryCode = signUpRuleOptions.countryCode !== null
    ? signUpRuleOptions.countryCode
    : getDerivedSignUpCountryCode(requestLocation?.countryCode ?? null, email);

  const riskScores = await calculateSignUpRiskScores(tenancy, {
    primaryEmail: email ?? null,
    primaryEmailVerified,
    authMethod: signUpRuleOptions.authMethod,
    oauthProvider: signUpRuleOptions.oauthProvider,
    ipAddress: requestIpAddress,
  });

  const ruleResult = await evaluateSignUpRules(tenancy, createSignUpRuleContext({
    email,
    countryCode,
    authMethod: signUpRuleOptions.authMethod,
    oauthProvider: signUpRuleOptions.oauthProvider,
    riskScores,
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
    : null;

  const enrichedCreateOrUpdate = {
    ...createOrUpdate,
    ...!!ruleResult.restrictedBecauseOfSignUpRuleId ? {
      restricted_by_admin: true,
      restricted_by_admin_private_details: existingRestrictionPrivateDetails != null ? `${existingRestrictionPrivateDetails}\n\n${restrictionPrivateDetails}` : restrictionPrivateDetails,
    } : {},
    country_code: countryCode,
    risk_scores: {
      sign_up: {
        bot: riskScores.bot,
        free_trial_abuse: riskScores.freeTrialAbuse,
      },
    },
  };

  return await createOrUpgradeAnonymousUserWithoutRules(
    tenancy,
    currentUser,
    enrichedCreateOrUpdate as KeyIntersect<UsersCrud["Admin"]["Create"], UsersCrud["Admin"]["Update"]>,
    allowedErrorTypes,
  );
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
    // Cast needed: createOrUpdate may contain create-only fields (like risk scores) that
    // KeyIntersect<Create, Update> strips from the type since they're absent on Update
    return await usersCrudHandlers.adminCreate({
      tenancy,
      data: createOrUpdate as UsersCrud["Admin"]["Create"],
      allowedErrorTypes,
    });
  }
}
