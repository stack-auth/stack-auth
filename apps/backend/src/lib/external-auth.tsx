import { getAuthContactChannelWithEmailNormalization } from "@/lib/contact-channel";
import { Tenancy } from "@/lib/tenancies";
import { PrismaClientTransaction } from "@/prisma-client";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { captureError, StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

/**
 * Email-based account merging shared between OAuth and SAML sign-in.
 *
 * When a new external sign-in arrives with an email that's already used
 * for auth by an existing user, this returns whether to link to that user
 * (link_method), reject (raise_error), or create a duplicate
 * (allow_duplicates).
 *
 * Lifted from oauth.tsx so the SAML ACS handler can reuse the same logic
 * without duplicating the merge-strategy switch and contact-channel
 * lookup.
 *
 * @returns linkedUserId - User ID to link to, or null if creating new user
 * @returns primaryEmailAuthEnabled - Whether the email should be used for auth
 */
export async function handleExternalEmailMergeStrategy(
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  params: {
    email: string,
    emailVerified: boolean,
    accountMergeStrategy: "link_method" | "raise_error" | "allow_duplicates",
  },
): Promise<{ linkedUserId: string | null, primaryEmailAuthEnabled: boolean }> {
  let primaryEmailAuthEnabled = true;
  let linkedUserId: string | null = null;

  const existingContactChannel = await getAuthContactChannelWithEmailNormalization(
    prisma,
    {
      tenancyId: tenancy.id,
      type: "EMAIL",
      value: params.email,
    },
  );

  if (existingContactChannel && existingContactChannel.usedForAuth) {
    switch (params.accountMergeStrategy) {
      case "link_method": {
        if (!existingContactChannel.isVerified) {
          throw new KnownErrors.ContactChannelAlreadyUsedForAuthBySomeoneElse("email", params.email, true);
        }
        if (!params.emailVerified) {
          // Edge case: existing user is verified, but the new external assertion claims an
          // unverified email. Linking would let an attacker hijack an account by claiming
          // the victim's email at an unverified IdP. We refuse for safety.
          const err = new StackAssertionError(
            "Account merge strategy is link_method, but the new external email is not verified.",
            { existingContactChannel, email: params.email, emailVerified: params.emailVerified },
          );
          captureError("external-auth-link-method-email-not-verified", err);
          throw new KnownErrors.ContactChannelAlreadyUsedForAuthBySomeoneElse("email", params.email);
        }
        linkedUserId = existingContactChannel.projectUserId;
        break;
      }
      case "raise_error": {
        throw new KnownErrors.ContactChannelAlreadyUsedForAuthBySomeoneElse("email", params.email);
      }
      case "allow_duplicates": {
        primaryEmailAuthEnabled = false;
        break;
      }
    }
  }

  return { linkedUserId, primaryEmailAuthEnabled };
}
