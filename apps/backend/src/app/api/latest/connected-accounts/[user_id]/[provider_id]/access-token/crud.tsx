import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import { getProvider } from "@/oauth";
import { TokenSet } from "@/oauth/providers/base";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { connectedAccountAccessTokenCrud } from "@stackframe/stack-shared/dist/interface/crud/connected-accounts";
import { userIdOrMeSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, StatusError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { extractScopes } from "@stackframe/stack-shared/dist/utils/strings";


export const connectedAccountAccessTokenCrudHandlers = createLazyProxy(() => createCrudHandlers(connectedAccountAccessTokenCrud, {
  paramsSchema: yupObject({
    provider_id: yupString().defined(),
    user_id: userIdOrMeSchema.defined(),
  }),
  async onCreate({ auth, data, params }) {
    if (auth.type === 'client' && auth.user?.id !== params.user_id) {
      throw new StatusError(StatusError.Forbidden, "Client can only access its own connected accounts");
    }

    const providerRaw = Object.entries(auth.tenancy.config.auth.oauth.providers).find(([providerId, _]) => providerId === params.provider_id);
    if (!providerRaw) {
      throw new KnownErrors.OAuthProviderNotFoundOrNotEnabled();
    }

    const provider = { id: providerRaw[0], ...providerRaw[1] };

    if (provider.isShared && getEnvVariable('STACK_ALLOW_SHARED_OAUTH_ACCESS_TOKENS') !== 'true') {
      throw new KnownErrors.OAuthAccessTokenNotAvailableWithSharedOAuthKeys();
    }

    const user = await usersCrudHandlers.adminRead({ tenancy: auth.tenancy, user_id: params.user_id });
    if (!user.oauth_providers.map(x => x.id).includes(params.provider_id)) {
      throw new KnownErrors.OAuthConnectionNotConnectedToUser();
    }

    const providerInstance = await getProvider(provider);

    // ====================== retrieve access token if it exists ======================
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const accessTokens = await prisma.oAuthAccessToken.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        projectUserOAuthAccount: {
          projectUserId: params.user_id,
          configOAuthProviderId: params.provider_id,
        },
        expiresAt: {
          // is at least 5 minutes in the future
          gt: new Date(Date.now() + 5 * 60 * 1000),
        },
        isValid: true,
      },
      include: {
        projectUserOAuthAccount: true,
      },
    });
    const filteredTokens = accessTokens.filter((t) => {
      return extractScopes(data.scope || "").every((scope) => t.scopes.includes(scope));
    });
    for (const token of filteredTokens) {
      // some providers (particularly GitHub) invalidate access tokens on the server-side, in which case we want to request a new access token
      if (await providerInstance.checkAccessTokenValidity(token.accessToken)) {
        return { access_token: token.accessToken };
      } else {
        // mark the token as invalid
        await prisma.oAuthAccessToken.update({
          where: {
            id: token.id,
          },
          data: {
            isValid: false,
          },
        });
      }
    }

    // ============== no valid access token found, try to refresh the token ==============

    const refreshTokens = await prisma.oAuthToken.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        projectUserOAuthAccount: {
          projectUserId: params.user_id,
          configOAuthProviderId: params.provider_id,
        },
        isValid: true,
      },
      include: {
        projectUserOAuthAccount: true,
      },
    });

    const filteredRefreshTokens = refreshTokens.filter((t) => {
      return extractScopes(data.scope || "").every((scope) => t.scopes.includes(scope));
    });

    if (filteredRefreshTokens.length === 0) {
      throw new KnownErrors.OAuthConnectionDoesNotHaveRequiredScope();
    }

    for (const token of filteredRefreshTokens) {
      let tokenSet: TokenSet;
      try {
        tokenSet = await providerInstance.getAccessToken({
          refreshToken: token.refreshToken,
          scope: data.scope,
        });
      } catch (error) {
        captureError('oauth-access-token-refresh-error', {
          error,
          tenancyId: auth.tenancy.id,
          providerId: params.provider_id,
          userId: params.user_id,
          refreshToken: token.refreshToken,
          scope: data.scope,
        });

        // mark the token as invalid
        await prisma.oAuthToken.update({
          where: { id: token.id },
          data: { isValid: false },
        });

        continue;
      }

      if (tokenSet.accessToken) {
        await prisma.oAuthAccessToken.create({
          data: {
            tenancyId: auth.tenancy.id,
            accessToken: tokenSet.accessToken,
            oauthAccountId: token.projectUserOAuthAccount.id,
            scopes: token.scopes,
            expiresAt: tokenSet.accessTokenExpiredAt
          }
        });

        if (tokenSet.refreshToken) {
          // remove the old token, add the new token to the DB
          await prisma.oAuthToken.deleteMany({
            where: {
              refreshToken: token.refreshToken,
            },
          });
          await prisma.oAuthToken.create({
            data: {
              tenancyId: auth.tenancy.id,
              refreshToken: tokenSet.refreshToken,
              oauthAccountId: token.projectUserOAuthAccount.id,
              scopes: token.scopes,
            }
          });
        }

        return { access_token: tokenSet.accessToken };
      } else {
        throw new StackAssertionError("No access token returned");
      }
    }

    throw new KnownErrors.OAuthConnectionDoesNotHaveRequiredScope();
  },
}));


