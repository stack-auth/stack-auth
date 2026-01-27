import { getAuthContactChannelWithEmailNormalization } from "@/lib/contact-channel";
import { createAuthTokens } from "@/lib/tokens";
import { createOrUpgradeAnonymousUser } from "@/lib/users";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createRemoteJWKSet, jwtVerify } from "jose";

// Apple's JWKS endpoint for verifying identity tokens
// See: https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_rest_api/verifying_a_user
const appleJWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

/**
 * Verifies an Apple identity token and extracts user info.
 * For native apps, the audience is the app's Bundle ID.
 */
async function verifyAppleIdToken(idToken: string, bundleId: string): Promise<{
  sub: string,
  email?: string,
  emailVerified: boolean,
}> {
  try {
    const { payload } = await jwtVerify(idToken, appleJWKS, {
      issuer: "https://appleid.apple.com",
      audience: bundleId,
    });

    return {
      sub: payload.sub ?? throwErr("No sub claim in Apple ID token"),
      email: typeof payload.email === "string" ? payload.email : undefined,
      emailVerified: payload.email_verified === true || payload.email_verified === "true",
    };
  } catch (error) {
    throw new KnownErrors.InvalidIdToken("apple", error instanceof Error ? error.message : "Unknown error");
  }
}

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Native Apple Sign In",
    description: "Authenticate a user using a native Sign In with Apple identity token. This endpoint is used by iOS/macOS apps that use the native ASAuthorizationController flow instead of web-based OAuth. The project must have Apple OAuth configured with the app's Bundle ID.",
    tags: ["Oauth"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    body: yupObject({
      id_token: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      access_token: yupString().defined(),
      refresh_token: yupString().defined(),
      user_id: yupString().defined(),
      is_new_user: yupBoolean().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, body }) {
    const prisma = await getPrismaClientForTenancy(tenancy);

    // Check if Apple OAuth provider is enabled for this project
    const providerRaw = Object.entries(tenancy.config.auth.oauth.providers).find(([providerId, _]) => providerId === "apple");
    if (!providerRaw) {
      throw new KnownErrors.OAuthProviderNotFoundOrNotEnabled();
    }
    const appleProvider = { id: providerRaw[0], ...providerRaw[1] };
    if (!appleProvider.allowSignIn) {
      throw new KnownErrors.OAuthProviderNotFoundOrNotEnabled();
    }

    // Get Apple Bundle ID from provider config
    // For native Apple Sign In, we need the app's Bundle ID (not the web Services ID)
    if (!appleProvider.appleBundleId) {
      throw new KnownErrors.OAuthProviderNotFoundOrNotEnabled();
    }
    const appleBundleId = appleProvider.appleBundleId;

    // Verify the identity token against the Bundle ID
    const appleUser = await verifyAppleIdToken(body.id_token, appleBundleId);

    // Check if user already exists with this Apple account
    const existingAccounts = await prisma.projectUserOAuthAccount.findMany({
      where: {
        tenancyId: tenancy.id,
        configOAuthProviderId: "apple",
        providerAccountId: appleUser.sub,
        allowSignIn: true,
      },
    });

    if (existingAccounts.length > 1) {
      throw new StackAssertionError("Multiple accounts found for the same Apple ID");
    }

    const existingAccount = existingAccounts[0] as (typeof existingAccounts)[number] | undefined;
    let projectUserId: string;
    let isNewUser = false;

    if (existingAccount) {
      // ========================== Existing user - sign in ==========================
      projectUserId = existingAccount.projectUserId ?? throwErr("OAuth account exists but has no associated user");
    } else {
      // ========================== New user - sign up ==========================

      let primaryEmailAuthEnabled = false;
      let linkedUserId: string | undefined;

      if (appleUser.email) {
        primaryEmailAuthEnabled = true;

        const existingContactChannel = await getAuthContactChannelWithEmailNormalization(
          prisma,
          {
            tenancyId: tenancy.id,
            type: "EMAIL",
            value: appleUser.email,
          }
        );

        // Check if we should link this OAuth account to an existing user based on email
        if (existingContactChannel && existingContactChannel.usedForAuth) {
          const accountMergeStrategy = tenancy.config.auth.oauth.accountMergeStrategy;
          switch (accountMergeStrategy) {
            case "link_method": {
              if (!existingContactChannel.isVerified) {
                throw new KnownErrors.ContactChannelAlreadyUsedForAuthBySomeoneElse("email", appleUser.email, true);
              }

              if (!appleUser.emailVerified) {
                // Apple reports email as not verified - don't allow linking
                throw new KnownErrors.ContactChannelAlreadyUsedForAuthBySomeoneElse("email", appleUser.email);
              }

              // Link to existing user
              linkedUserId = existingContactChannel.projectUserId;
              break;
            }
            case "raise_error": {
              throw new KnownErrors.ContactChannelAlreadyUsedForAuthBySomeoneElse("email", appleUser.email);
            }
            case "allow_duplicates": {
              primaryEmailAuthEnabled = false;
              break;
            }
          }
        }
      }

      if (linkedUserId) {
        // ========================== Link Apple account to existing user ==========================
        projectUserId = linkedUserId;

        // Create OAuth account link
        await prisma.projectUserOAuthAccount.create({
          data: {
            configOAuthProviderId: "apple",
            providerAccountId: appleUser.sub,
            email: appleUser.email,
            projectUser: {
              connect: {
                tenancyId_projectUserId: {
                  tenancyId: tenancy.id,
                  projectUserId,
                },
              },
            },
          },
        });

        // Create auth method for the linked user
        await prisma.authMethod.create({
          data: {
            tenancyId: tenancy.id,
            projectUserId,
            oauthAuthMethod: {
              create: {
                projectUserId,
                configOAuthProviderId: "apple",
                providerAccountId: appleUser.sub,
              }
            }
          }
        });
      } else {
        // ========================== Create new user ==========================

        // Check if sign up is allowed
        if (!tenancy.config.auth.allowSignUp) {
          throw new KnownErrors.SignUpNotEnabled();
        }

        // Create new user (or upgrade anonymous user)
        const newUser = await createOrUpgradeAnonymousUser(
          tenancy,
          null, // No existing user to upgrade
          {
            primary_email: appleUser.email,
            primary_email_verified: appleUser.emailVerified,
            primary_email_auth_enabled: primaryEmailAuthEnabled,
          },
          [],
        );
        projectUserId = newUser.id;
        isNewUser = true;

        // Create auth method
        const authMethod = await prisma.authMethod.create({
          data: {
            tenancyId: tenancy.id,
            projectUserId,
          }
        });

        // Create OAuth account link
        await prisma.projectUserOAuthAccount.create({
          data: {
            tenancyId: tenancy.id,
            configOAuthProviderId: "apple",
            providerAccountId: appleUser.sub,
            email: appleUser.email,
            projectUserId,
            oauthAuthMethod: {
              create: {
                authMethodId: authMethod.id,
              }
            },
            allowConnectedAccounts: true,
            allowSignIn: true,
          },
        });
      }
    }

    // Generate tokens
    const { refreshToken, accessToken } = await createAuthTokens({
      tenancy,
      projectUserId,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        access_token: accessToken,
        refresh_token: refreshToken,
        user_id: projectUserId,
        is_new_user: isNewUser,
      },
    };
  },
});
