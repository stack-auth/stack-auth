import { handleExternalEmailMergeStrategy } from "@/lib/external-auth";
import { Tenancy } from "@/lib/tenancies";
import { createOrUpgradeAnonymousUserWithRules, SignUpRuleOptions } from "@/lib/users";
import { PrismaClientTransaction } from "@/prisma-client";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";

/**
 * Find an existing OAuth account for sign-in.
 *
 * @returns The existing account if found, or null if no account exists
 * @throws StackAssertionError if multiple accounts are found (should never happen)
 */
export async function findExistingOAuthAccount(
  prisma: PrismaClientTransaction,
  tenancyId: string,
  providerId: string,
  providerAccountId: string,
) {
  const existingAccounts = await prisma.projectUserOAuthAccount.findMany({
    where: {
      tenancyId,
      configOAuthProviderId: providerId,
      providerAccountId,
      allowSignIn: true,
    },
  });

  if (existingAccounts.length > 1) {
    throw new StackAssertionError("Multiple accounts found for the same provider and account ID", {
      providerId,
      providerAccountId,
    });
  }

  const account = existingAccounts[0] as (typeof existingAccounts)[number] | undefined;
  return account ?? null;
}

/**
 * Get the project user ID from an OAuth account, throwing if it doesn't exist.
 */
export function getProjectUserIdFromOAuthAccount(
  account: Awaited<ReturnType<typeof findExistingOAuthAccount>>
): string {
  if (!account) {
    throw new StackAssertionError("OAuth account is null");
  }
  return account.projectUserId ?? throwErr("OAuth account exists but has no associated user");
}

/**
 * Handle the OAuth email merge strategy.
 *
 * Thin wrapper around handleExternalEmailMergeStrategy that pulls the
 * project's OAuth-specific account merge strategy from tenancy config.
 *
 * @returns linkedUserId - The user ID to link to, or null if creating a new user
 * @returns primaryEmailAuthEnabled - Whether the email should be used for auth
 */
export async function handleOAuthEmailMergeStrategy(
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  email: string,
  emailVerified: boolean,
): Promise<{ linkedUserId: string | null, primaryEmailAuthEnabled: boolean }> {
  return await handleExternalEmailMergeStrategy(prisma, tenancy, {
    email,
    emailVerified,
    accountMergeStrategy: tenancy.config.auth.oauth.accountMergeStrategy,
  });
}

/**
 * Link an OAuth account to an existing user.
 *
 * This is used when the email merge strategy determines that a new OAuth sign-in
 * should be linked to an existing user account.
 *
 * Creates:
 * - OAuth account record (connected to the existing user)
 * - Auth method record with nested oauthAuthMethod
 *
 * @returns oauthAccountId - The ID of the created OAuth account
 */
export async function linkOAuthAccountToUser(
  prisma: PrismaClientTransaction,
  params: {
    tenancyId: string,
    providerId: string,
    providerAccountId: string,
    email: string | null,
    projectUserId: string,
  }
): Promise<{ oauthAccountId: string }> {
  // Create OAuth account link
  const oauthAccount = await prisma.projectUserOAuthAccount.create({
    data: {
      configOAuthProviderId: params.providerId,
      providerAccountId: params.providerAccountId,
      email: params.email,
      projectUser: {
        connect: {
          tenancyId_projectUserId: {
            tenancyId: params.tenancyId,
            projectUserId: params.projectUserId,
          },
        },
      },
    },
  });

  // Create auth method for the linked user
  await prisma.authMethod.create({
    data: {
      tenancyId: params.tenancyId,
      projectUserId: params.projectUserId,
      oauthAuthMethod: {
        create: {
          projectUserId: params.projectUserId,
          configOAuthProviderId: params.providerId,
          providerAccountId: params.providerAccountId,
        }
      }
    }
  });

  return { oauthAccountId: oauthAccount.id };
}

/**
 * Create a new user and OAuth account.
 *
 * This is used when a new OAuth sign-up should create a new user account.
 *
 * Creates:
 * - User record (via createOrUpgradeAnonymousUserWithRules)
 * - Auth method record
 * - OAuth account record with nested oauthAuthMethod
 *
 * @returns projectUserId - The ID of the created user
 * @returns oauthAccountId - The ID of the created OAuth account
 */
export async function createOAuthUserAndAccount(
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  params: {
    providerId: string,
    providerAccountId: string,
    email: string | null,
    emailVerified: boolean,
    primaryEmailAuthEnabled: boolean,
    currentUser: UsersCrud["Admin"]["Read"] | null,
    displayName: string | null,
    profileImageUrl: string | null,
    signUpRuleOptions: SignUpRuleOptions,
  }
): Promise<{ projectUserId: string, oauthAccountId: string }> {
  // Check if sign up is allowed
  if (!tenancy.config.auth.allowSignUp) {
    throw new KnownErrors.SignUpNotEnabled();
  }

  // Create new user (or upgrade anonymous user) with sign-up rule evaluation
  const newUser = await createOrUpgradeAnonymousUserWithRules(
    tenancy,
    params.currentUser,
    {
      display_name: params.displayName,
      profile_image_url: params.profileImageUrl,
      primary_email: params.email,
      primary_email_verified: params.emailVerified,
      primary_email_auth_enabled: params.primaryEmailAuthEnabled,
    },
    [],
    params.signUpRuleOptions,
  );

  // Create auth method
  const authMethod = await prisma.authMethod.create({
    data: {
      tenancyId: tenancy.id,
      projectUserId: newUser.id,
    }
  });

  // Create OAuth account link
  const oauthAccount = await prisma.projectUserOAuthAccount.create({
    data: {
      tenancyId: tenancy.id,
      configOAuthProviderId: params.providerId,
      providerAccountId: params.providerAccountId,
      email: params.email,
      projectUserId: newUser.id,
      oauthAuthMethod: {
        create: {
          authMethodId: authMethod.id,
        }
      },
      allowConnectedAccounts: true,
      allowSignIn: true,
    },
  });

  return { projectUserId: newUser.id, oauthAccountId: oauthAccount.id };
}
