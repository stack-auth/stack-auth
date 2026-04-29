import { handleExternalEmailMergeStrategy } from "@/lib/external-auth";
import { Tenancy } from "@/lib/tenancies";
import { createOrUpgradeAnonymousUserWithRules, SignUpRuleOptions } from "@/lib/users";
import { PrismaClientTransaction } from "@/prisma-client";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";

/**
 * Find an existing SAML account by NameID within a connection. Used when the
 * ACS handler receives a verified assertion and needs to look up the user.
 *
 * Connection isolation invariant: the unique key includes samlConnectionId,
 * so the same NameID arriving from a different connection is treated as a
 * separate identity. Tests covered: "two connections, two distinct user
 * pools" + "cross-connection assertion forgery" (see plan §multi-tenancy).
 */
export async function findExistingSamlAccount(
  prisma: PrismaClientTransaction,
  tenancyId: string,
  samlConnectionId: string,
  nameId: string,
) {
  const account = await prisma.projectUserSamlAccount.findUnique({
    where: {
      tenancyId_samlConnectionId_nameId: {
        tenancyId,
        samlConnectionId,
        nameId,
      },
    },
  });
  // allowSignIn=false means the user (or admin) has disabled SAML sign-in for
  // this account — treat as if not found so the caller errors out cleanly.
  if (account && !account.allowSignIn) {
    return null;
  }
  return account;
}

export function getProjectUserIdFromSamlAccount(
  account: Awaited<ReturnType<typeof findExistingSamlAccount>>,
): string {
  if (!account) {
    throw new StackAssertionError("SAML account is null");
  }
  return account.projectUserId ?? throwErr("SAML account exists but has no associated user");
}

/**
 * Wraps the shared email-merge logic with the SAML-specific config path.
 * Defaults to "link_method" if the project hasn't configured a strategy
 * (the same default as OAuth).
 */
export async function handleSamlEmailMergeStrategy(
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  params: { email: string, emailVerified: boolean },
): Promise<{ linkedUserId: string | null, primaryEmailAuthEnabled: boolean }> {
  // Read SAML-specific strategy from config; fall back to OAuth's strategy if
  // not set, so existing projects keep consistent behavior across protocols
  // until they explicitly opt into a different SAML policy.
  const samlConfig = (tenancy.config.auth as { saml?: { accountMergeStrategy?: "link_method" | "raise_error" | "allow_duplicates" } }).saml;
  const accountMergeStrategy = samlConfig?.accountMergeStrategy ?? tenancy.config.auth.oauth.accountMergeStrategy;
  return await handleExternalEmailMergeStrategy(prisma, tenancy, {
    email: params.email,
    emailVerified: params.emailVerified,
    accountMergeStrategy,
  });
}

/**
 * Link a verified SAML identity to an already-existing user (matched by email).
 * Mirrors linkOAuthAccountToUser. Creates one ProjectUserSamlAccount and one
 * AuthMethod with a nested SamlAuthMethod.
 */
export async function linkSamlAccountToUser(
  prisma: PrismaClientTransaction,
  params: {
    tenancyId: string,
    samlConnectionId: string,
    nameId: string,
    nameIdFormat: string | null,
    email: string | null,
    projectUserId: string,
  },
): Promise<{ samlAccountId: string }> {
  const samlAccount = await prisma.projectUserSamlAccount.create({
    data: {
      tenancyId: params.tenancyId,
      samlConnectionId: params.samlConnectionId,
      nameId: params.nameId,
      nameIdFormat: params.nameIdFormat,
      email: params.email,
      projectUserId: params.projectUserId,
    },
  });

  await prisma.authMethod.create({
    data: {
      tenancyId: params.tenancyId,
      projectUserId: params.projectUserId,
      samlAuthMethod: {
        create: {
          projectUserId: params.projectUserId,
          samlConnectionId: params.samlConnectionId,
          nameId: params.nameId,
        },
      },
    },
  });

  return { samlAccountId: samlAccount.id };
}

/**
 * Create a new user from a verified SAML identity. JIT provisioning — runs
 * when no existing account or matching email is found. Mirrors
 * createOAuthUserAndAccount.
 */
export async function createSamlUserAndAccount(
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  params: {
    samlConnectionId: string,
    nameId: string,
    nameIdFormat: string | null,
    email: string | null,
    emailVerified: boolean,
    primaryEmailAuthEnabled: boolean,
    currentUser: UsersCrud["Admin"]["Read"] | null,
    displayName: string | null,
    profileImageUrl: string | null,
    signUpRuleOptions: SignUpRuleOptions,
  },
): Promise<{ projectUserId: string, samlAccountId: string }> {
  if (!tenancy.config.auth.allowSignUp) {
    throw new KnownErrors.SignUpNotEnabled();
  }

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

  const authMethod = await prisma.authMethod.create({
    data: {
      tenancyId: tenancy.id,
      projectUserId: newUser.id,
    },
  });

  const samlAccount = await prisma.projectUserSamlAccount.create({
    data: {
      tenancyId: tenancy.id,
      samlConnectionId: params.samlConnectionId,
      nameId: params.nameId,
      nameIdFormat: params.nameIdFormat,
      email: params.email,
      projectUserId: newUser.id,
      samlAuthMethod: {
        create: {
          authMethodId: authMethod.id,
        },
      },
      allowSignIn: true,
    },
  });

  return { projectUserId: newUser.id, samlAccountId: samlAccount.id };
}
