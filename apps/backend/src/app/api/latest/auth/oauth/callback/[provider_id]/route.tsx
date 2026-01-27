import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import { createOAuthUserAndAccount, findExistingOAuthAccount, handleOAuthEmailMergeStrategy, linkOAuthAccountToUser } from "@/lib/oauth";
import { isAcceptedNativeAppUrl, validateRedirectUrl } from "@/lib/redirect-urls";
import { Tenancy, getTenancy } from "@/lib/tenancies";
import { oauthCookieSchema } from "@/lib/tokens";
import { getProvider, oauthServer } from "@/oauth";
import { PrismaClientTransaction, getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { InvalidClientError, InvalidScopeError, Request as OAuthRequest, Response as OAuthResponse } from "@node-oauth/oauth2-server";
import { KnownError, KnownErrors } from "@stackframe/stack-shared";
import { yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, StatusError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { deindent, extractScopes } from "@stackframe/stack-shared/dist/utils/strings";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { oauthResponseToSmartResponse } from "../../oauth-helpers";

/**
 * Create a project user OAuth account with the provided data.
 * Used for the "link" flow which doesn't go through the standard sign-up path.
 */
async function createProjectUserOAuthAccountForLink(prisma: PrismaClientTransaction, params: {
  tenancyId: string,
  providerId: string,
  providerAccountId: string,
  email?: string | null,
  projectUserId: string,
}) {
  return await prisma.projectUserOAuthAccount.create({
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
}

const redirectOrThrowError = (error: KnownError, tenancy: Tenancy, errorRedirectUrl?: string) => {
  if (!errorRedirectUrl || (!validateRedirectUrl(errorRedirectUrl, tenancy) && !isAcceptedNativeAppUrl(errorRedirectUrl))) {
    throw error;
  }

  const url = new URL(errorRedirectUrl);
  url.searchParams.set("errorCode", error.errorCode);
  url.searchParams.set("message", error.message);
  url.searchParams.set("details", error.details ? JSON.stringify(error.details) : JSON.stringify({}));
  redirect(url.toString());
};

const handler = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    params: yupObject({
      provider_id: yupString().defined(),
    }).defined(),
    query: yupMixed().optional(),
    body: yupMixed().optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([307, 303]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
    headers: yupMixed().defined(),
  }),
  async handler({ params, query, body }, fullReq) {
    const innerState = query.state ?? (body as any)?.state ?? "";
    const cookieInfo = (await cookies()).get("stack-oauth-inner-" + innerState);
    (await cookies()).delete("stack-oauth-inner-" + innerState);

    if (cookieInfo?.value !== 'true') {
      throw new StatusError(StatusError.BadRequest, "Inner OAuth cookie not found. This is likely because you refreshed the page during the OAuth sign in process. Please try signing in again");
    }

    const outerInfoDB = await globalPrismaClient.oAuthOuterInfo.findUnique({
      where: {
        innerState: innerState,
      },
    });

    if (!outerInfoDB) {
      throw new StatusError(StatusError.BadRequest, "Invalid OAuth cookie. Please try signing in again.");
    }

    let outerInfo: Awaited<ReturnType<typeof oauthCookieSchema.validate>>;
    try {
      outerInfo = await oauthCookieSchema.validate(outerInfoDB.info);
    } catch (error) {
      throw new StackAssertionError("Invalid outer info");
    }

    const {
      tenancyId,
      innerCodeVerifier,
      type,
      projectUserId,
      providerScope,
      errorRedirectUrl,
      afterCallbackRedirectUrl,
    } = outerInfo;

    const tenancy = await getTenancy(tenancyId);
    if (!tenancy) {
      throw new StackAssertionError("Tenancy in outerInfo not found; has it been deleted?", { tenancyId });
    }
    const prisma = await getPrismaClientForTenancy(tenancy);

    try {
      if (outerInfoDB.expiresAt < new Date()) {
        throw new KnownErrors.OuterOAuthTimeout();
      }

      const providerRaw = Object.entries(tenancy.config.auth.oauth.providers).find(([providerId, _]) => providerId === params.provider_id);
      if (!providerRaw) {
        throw new KnownErrors.OAuthProviderNotFoundOrNotEnabled();
      }

      const provider = { id: providerRaw[0], ...providerRaw[1] };

      const providerObj = await getProvider(provider as any);
      let callbackResult: Awaited<ReturnType<typeof providerObj.getCallback>>;
      try {
        callbackResult = await providerObj.getCallback({
          codeVerifier: innerCodeVerifier,
          state: innerState,
          callbackParams: {
            ...query,
            ...body,
          },
        });
      } catch (error) {
        if (KnownErrors['OAuthProviderAccessDenied'].isInstance(error)) {
          redirectOrThrowError(error, tenancy, errorRedirectUrl);
        }
        throw error;
      }

      const { userInfo, tokenSet } = callbackResult;

      if (type === "link") {
        if (!projectUserId) {
          throw new StackAssertionError("projectUserId not found in cookie when authorizing signed in user");
        }

        const user = await prisma.projectUser.findUnique({
          where: {
            tenancyId_projectUserId: {
              tenancyId,
              projectUserId,
            },
          },
          include: {
            projectUserOAuthAccounts: true,
          }
        });
        if (!user) {
          throw new StackAssertionError("User not found");
        }
      }

      const oauthRequest = new OAuthRequest({
        headers: {},
        body: {},
        method: "GET",
        query: {
          client_id: `${tenancy.project.id}#${tenancy.branchId}`,
          client_secret: outerInfo.publishableClientKey,
          redirect_uri: outerInfo.redirectUri,
          state: outerInfo.state,
          scope: outerInfo.scope,
          grant_type: outerInfo.grantType,
          code_challenge: outerInfo.codeChallenge,
          code_challenge_method: outerInfo.codeChallengeMethod,
          response_type: outerInfo.responseType,
        }
      });

      const storeTokens = async (oauthAccountId: string) => {
        if (tokenSet.refreshToken) {
          await prisma.oAuthToken.create({
            data: {
              tenancyId: outerInfo.tenancyId,
              refreshToken: tokenSet.refreshToken,
              scopes: extractScopes(providerObj.scope + " " + providerScope),
              oauthAccountId,
            }
          });
        }

        await prisma.oAuthAccessToken.create({
          data: {
            tenancyId: outerInfo.tenancyId,
            accessToken: tokenSet.accessToken,
            scopes: extractScopes(providerObj.scope + " " + providerScope),
            expiresAt: tokenSet.accessTokenExpiredAt,
            oauthAccountId,
          }
        });
      };

      const oauthResponse = new OAuthResponse();
      try {
        await oauthServer.authorize(
          oauthRequest,
          oauthResponse,
          {
            authenticateHandler: {
              handle: async () => {
                // Find existing OAuth account (used by both link and sign-in flows)
                const oldAccount = await findExistingOAuthAccount(
                  prisma,
                  outerInfo.tenancyId,
                  provider.id,
                  userInfo.accountId
                );

                // ========================== link account with user ==========================
                // This flow is when a signed-in user wants to connect an OAuth account
                if (type === "link") {
                  if (!projectUserId) {
                    throw new StackAssertionError("projectUserId not found in cookie when authorizing signed in user");
                  }

                  if (oldAccount) {
                    // ========================== account already connected ==========================
                    if (oldAccount.projectUserId !== projectUserId) {
                      throw new KnownErrors.OAuthConnectionAlreadyConnectedToAnotherUser();
                    }
                    await storeTokens(oldAccount.id);
                  } else {
                    // ========================== connect account with user ==========================
                    const newOAuthAccount = await createProjectUserOAuthAccountForLink(prisma, {
                      tenancyId: outerInfo.tenancyId,
                      providerId: provider.id,
                      providerAccountId: userInfo.accountId,
                      email: userInfo.email,
                      projectUserId,
                    });

                    await storeTokens(newOAuthAccount.id);
                  }

                  return {
                    id: projectUserId,
                    newUser: false,
                    afterCallbackRedirectUrl,
                  };
                }

                // ========================== sign in / sign up flow ==========================

                // Check if user already exists with this OAuth account
                if (oldAccount) {
                  await storeTokens(oldAccount.id);

                  return {
                    id: oldAccount.projectUserId,
                    newUser: false,
                    afterCallbackRedirectUrl,
                  };
                }

                // ========================== sign up user ==========================

                // Handle email merge strategy if email is provided
                const { linkedUserId, primaryEmailAuthEnabled } = userInfo.email
                  ? await handleOAuthEmailMergeStrategy(prisma, tenancy, userInfo.email, userInfo.emailVerified)
                  : { linkedUserId: null, primaryEmailAuthEnabled: false };

                if (linkedUserId) {
                  // ========================== Link OAuth account to existing user via email ==========================
                  const { oauthAccountId } = await linkOAuthAccountToUser(prisma, {
                    tenancyId: outerInfo.tenancyId,
                    providerId: provider.id,
                    providerAccountId: userInfo.accountId,
                    email: userInfo.email ?? undefined,
                    projectUserId: linkedUserId,
                  });

                  await storeTokens(oauthAccountId);
                  return {
                    id: linkedUserId,
                    newUser: false,
                    afterCallbackRedirectUrl,
                  };
                }

                // ========================== Create new user ==========================

                // Get currentUser for anonymous user upgrade (if they were signed in during /authorize)
                let currentUser = null;
                if (projectUserId) {
                  // Note: it's possible that the user has been deleted, but the request is still
                  // done with a token that was issued before the user was deleted (or the user was
                  // deleted between the /authorize and /callback requests)
                  try {
                    currentUser = await usersCrudHandlers.adminRead({
                      tenancy,
                      user_id: projectUserId,
                      allowedErrorTypes: [KnownErrors.UserNotFound],
                    });
                  } catch (error) {
                    if (!KnownErrors.UserNotFound.isInstance(error)) {
                      throw error;
                    }
                  }
                }

                const { projectUserId: newUserId, oauthAccountId } = await createOAuthUserAndAccount(
                  prisma,
                  tenancy,
                  {
                    providerId: provider.id,
                    providerAccountId: userInfo.accountId,
                    email: userInfo.email ?? undefined,
                    emailVerified: userInfo.emailVerified,
                    primaryEmailAuthEnabled,
                    currentUser,
                    displayName: userInfo.displayName ?? undefined,
                    profileImageUrl: userInfo.profileImageUrl ?? undefined,
                  }
                );

                await storeTokens(oauthAccountId);

                return {
                  id: newUserId,
                  newUser: true,
                  afterCallbackRedirectUrl,
                };
              }
            }
          }
        );
      } catch (error) {
        if (error instanceof InvalidClientError) {
          if (error.message.includes("redirect_uri") || error.message.includes("redirectUri")) {
            console.log("User is trying to authorize OAuth with an invalid redirect URI", error, { redirectUri: oauthRequest.query?.redirect_uri, clientId: oauthRequest.query?.client_id });
            throw new KnownErrors.RedirectUrlNotWhitelisted();
          }
        } else if (error instanceof InvalidScopeError) {
          // which scopes are being requested, and by whom?
          // I think this is a bug in the client? But just to be safe, let's log an error to make sure that it is not our fault
          // TODO: remove the captureError once you see in production that our own clients never trigger this
          captureError("outer-oauth-callback-invalid-scope", new StackAssertionError(deindent`
            A client requested an invalid scope. Is this a bug in the client, or our fault?

              Scopes requested: ${oauthRequest.query?.scope}
          `, { outerInfo, cause: error, scopes: oauthRequest.query?.scope }));
          throw new StatusError(400, "Invalid scope requested. Please check the scopes you are requesting.");
        }
        throw error;
      }

      return oauthResponseToSmartResponse(oauthResponse);
    } catch (error) {
      if (KnownError.isKnownError(error)) {
        redirectOrThrowError(error, tenancy, errorRedirectUrl);
      }
      throw error;
    }
  },
});

export const GET = handler;
export const POST = handler;
