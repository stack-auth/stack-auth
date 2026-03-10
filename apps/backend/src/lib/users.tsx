import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { KnownErrors } from "@stackframe/stack-shared";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { normalizeCountryCode, validCountryCodeSet } from "@stackframe/stack-shared/dist/schema-fields";
import { KeyIntersect } from "@stackframe/stack-shared/dist/utils/types";
import { createSignUpRuleContext } from "./cel-evaluator";
import { getBestEffortEndUserRequestContext } from "./end-users";
import { calculateSignUpRiskAssessment } from "./risk-scores";
import { evaluateSignUpRules } from "./sign-up-rules";
import { Tenancy } from "./tenancies";
import { SignUpTurnstileAssessment } from "./turnstile";

/**
 * Options for sign-up rule evaluation context.
 */
export type SignUpRuleOptions = {
  authMethod: 'password' | 'otp' | 'oauth' | 'passkey',
  oauthProvider: string | null,
  ipAddress: string | null,
  ipTrusted: boolean | null,
  countryCode: string | null,
  turnstileAssessment: SignUpTurnstileAssessment | null,
};

async function persistSignUpHeuristicFacts(params: {
  tenancy: Tenancy,
  userId: string,
  signUpAt: Date,
  signUpIp: string | null,
  signUpIpTrusted: boolean | null,
  signUpEmailNormalized: string | null,
  signUpEmailBase: string | null,
}) {
  const prisma = await getPrismaClientForTenancy(params.tenancy);
  await prisma.projectUser.update({
    where: {
      tenancyId_projectUserId: {
        tenancyId: params.tenancy.id,
        projectUserId: params.userId,
      },
    },
    data: {
      signUpAt: params.signUpAt,
      signUpIp: params.signUpIp,
      signUpIpTrusted: params.signUpIpTrusted,
      signUpEmailNormalized: params.signUpEmailNormalized,
      signUpEmailBase: params.signUpEmailBase,
      shouldUpdateSequenceId: true,
    },
  });
}

export function getDerivedSignUpCountryCode(requestCountryCode: string | null, email: string | null): string | null {
  if (email != null) {
    const match = email.match(/^[^+]+\+([^@]+)@example\.com$/i);
    if (match) {
      const tag = match[1];
      const normalized = normalizeCountryCode(tag);
      if (validCountryCodeSet.has(normalized)) {
        return normalized;
      }
    }
  }

  if (requestCountryCode !== null) {
    const normalized = normalizeCountryCode(requestCountryCode);
    if (validCountryCodeSet.has(normalized)) {
      return normalized;
    }
  }
  return null;
}
import.meta.vitest?.test("getDerivedSignUpCountryCode", ({ expect }) => {
  expect(getDerivedSignUpCountryCode(" us ", null)).toBe("US");
  expect(getDerivedSignUpCountryCode("usa", null)).toBeNull();
  expect(getDerivedSignUpCountryCode("1", null)).toBeNull();

  expect(getDerivedSignUpCountryCode(null, "test+us@example.com")).toBe("US");
  expect(getDerivedSignUpCountryCode(null, "test+de@example.com")).toBe("DE");
  expect(getDerivedSignUpCountryCode(null, "test+US@example.com")).toBe("US");
  expect(getDerivedSignUpCountryCode(null, "test+invalid@example.com")).toBeNull();
  expect(getDerivedSignUpCountryCode(null, "test+us@other.com")).toBeNull();
  expect(getDerivedSignUpCountryCode(null, "test@example.com")).toBeNull();
  expect(getDerivedSignUpCountryCode(null, "noplustag@example.com")).toBeNull();

  expect(getDerivedSignUpCountryCode("de", "test+us@example.com")).toBe("US");
  expect(getDerivedSignUpCountryCode("de", "test@example.com")).toBe("DE");
});

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
  const endUserRequestContext = signUpRuleOptions.ipAddress !== null && signUpRuleOptions.ipTrusted !== null && signUpRuleOptions.countryCode !== null
    ? null
    : await getBestEffortEndUserRequestContext();
  const requestIpAddress = signUpRuleOptions.ipAddress ?? endUserRequestContext?.ipAddress ?? null;
  const requestIpTrusted = signUpRuleOptions.ipTrusted ?? endUserRequestContext?.ipTrusted ?? null;
  const requestCountryCode = signUpRuleOptions.countryCode ?? endUserRequestContext?.location?.countryCode ?? null;
  const countryCode = signUpRuleOptions.countryCode !== null
    ? signUpRuleOptions.countryCode
    : getDerivedSignUpCountryCode(requestCountryCode, email);
  const countryCodeToPersist = currentUser?.is_anonymous && currentUser.country_code != null
    ? currentUser.country_code
    : countryCode;

  const riskAssessment = await calculateSignUpRiskAssessment(tenancy, {
    primaryEmail: email ?? null,
    primaryEmailVerified,
    authMethod: signUpRuleOptions.authMethod,
    oauthProvider: signUpRuleOptions.oauthProvider,
    ipAddress: requestIpAddress,
    ipTrusted: requestIpTrusted,
    turnstileAssessment: signUpRuleOptions.turnstileAssessment ?? { status: "not_configured" },
  });
  const riskScores = riskAssessment.scores;

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
    ...(ruleResult.restrictedBecauseOfSignUpRuleId != null ? {
      restricted_by_admin: true,
      restricted_by_admin_private_details: existingRestrictionPrivateDetails != null ? `${existingRestrictionPrivateDetails}\n\n${restrictionPrivateDetails}` : restrictionPrivateDetails,
    } : {}),
    ...(countryCodeToPersist !== null ? { country_code: countryCodeToPersist } : {}),
    risk_scores: {
      sign_up: {
        bot: riskScores.bot,
        free_trial_abuse: riskScores.free_trial_abuse,
      },
    },
  };

  const signUpHeuristicFactsToPersist = {
    tenancy,
    signUpAt: riskAssessment.heuristicFacts.signUpAt,
    signUpIp: riskAssessment.heuristicFacts.signUpIp,
    signUpIpTrusted: riskAssessment.heuristicFacts.signUpIpTrusted,
    signUpEmailNormalized: riskAssessment.heuristicFacts.signUpEmailNormalized,
    signUpEmailBase: riskAssessment.heuristicFacts.signUpEmailBase,
  } as const;

  if (currentUser?.is_anonymous) {
    await persistSignUpHeuristicFacts({
      ...signUpHeuristicFactsToPersist,
      userId: currentUser.id,
    });
  }

  const user = await createOrUpgradeAnonymousUserWithoutRules(
    tenancy,
    currentUser,
    enrichedCreateOrUpdate as KeyIntersect<UsersCrud["Admin"]["Create"], UsersCrud["Admin"]["Update"]>,
    allowedErrorTypes,
  );
  if (!currentUser?.is_anonymous) {
    await persistSignUpHeuristicFacts({
      ...signUpHeuristicFactsToPersist,
      userId: user.id,
    });
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
