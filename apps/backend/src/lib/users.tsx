import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { KeyIntersect } from "@stackframe/stack-shared/dist/utils/types";
import { Tenancy } from "./tenancies";
import { createSignupRuleContext } from "./cel-evaluator";
import { evaluateAndApplySignupRules, SignupRuleMetadataEntry } from "./signup-rules";

/**
 * Options for signup rule evaluation context.
 */
export type SignupRuleOptions = {
  authMethod: 'password' | 'otp' | 'oauth' | 'passkey',
  oauthProvider?: string,
};

/**
 * Creates or upgrades an anonymous user with signup rule evaluation.
 *
 * This function evaluates signup rules before creating/upgrading the user.
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
 * @param signupRuleOptions - Options for signup rule evaluation
 * @returns Created or updated user
 * @throws KnownErrors.SignUpRejected if a signup rule rejects the signup
 */
export async function createOrUpgradeAnonymousUserWithRules(
  tenancy: Tenancy,
  currentUser: UsersCrud["Admin"]["Read"] | null,
  createOrUpdate: KeyIntersect<UsersCrud["Admin"]["Create"], UsersCrud["Admin"]["Update"]>,
  allowedErrorTypes: (new (...args: any) => any)[],
  signupRuleOptions: SignupRuleOptions,
): Promise<UsersCrud["Admin"]["Read"]> {
  // Get email from create/update data
  // TypeScript doesn't know this field exists due to KeyIntersect, but it's always passed for signup
  const email = (createOrUpdate as { primary_email?: string }).primary_email ?? '';

  // Create context for rule evaluation
  const context = createSignupRuleContext({
    email,
    authMethod: signupRuleOptions.authMethod,
    oauthProvider: signupRuleOptions.oauthProvider,
  });

  // Evaluate and apply signup rules (may throw if rejected)
  const ruleResult = await evaluateAndApplySignupRules(tenancy, context);

  // Build metadata objects for each target from signup rule metadata
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

  // Merge signup rule data into createOrUpdate
  // Use type assertion as we know the structure from UsersCrud
  const createOrUpdateWithMeta = createOrUpdate as Record<string, unknown>;

  // Build the private restriction details if shouldRestrict is true
  // The public reason is left empty - admins can set it manually if they want to show something to the user
  const restrictionPrivateDetails = ruleResult.shouldRestrict && ruleResult.ruleId
    ? `Restricted by signup rule: ${ruleResult.ruleId}`
    : ruleResult.shouldRestrict
      ? 'Restricted by signup rules'
      : undefined;

  const enrichedCreateOrUpdate = {
    ...createOrUpdate,
    // Merge client_metadata (signup rule metadata overwrites existing keys)
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
  return await createOrUpgradeAnonymousUser(
    tenancy,
    currentUser,
    enrichedCreateOrUpdate as KeyIntersect<UsersCrud["Admin"]["Create"], UsersCrud["Admin"]["Update"]>,
    allowedErrorTypes,
  );
}

/**
 * Creates or upgrades an anonymous user WITHOUT signup rule evaluation.
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
