import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import { getProvider } from "@/oauth";
import { TokenSet } from "@/oauth/providers/base";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { connectedAccountAccessTokenCrud } from "@stackframe/stack-shared/dist/interface/crud/connected-accounts";
import { userIdOrMeSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, StatusError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { extractScopes } from "@stackframe/stack-shared/dist/utils/strings";


export const connectedAccountAccessTokenByAccountCrudHandlers = createLazyProxy(() => createCrudHandlers(connectedAccountAccessTokenCrud, {
  paramsSchema: yupObject({
    provider_id: yupString().defined(),
    provider_account_id: yupString().defined(),
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

    if (provider.isShared && !getNodeEnvironment().includes('prod') && getEnvVariable('STACK_ALLOW_SHARED_OAUTH_ACCESS_TOKENS', '') !== 'true') {
      throw new KnownErrors.OAuthAccessTokenNotAvailableWithSharedOAuthKeys();
    }

    const user = await usersCrudHandlers.adminRead({ tenancy: auth.tenancy, user_id: params.user_id });

    // Find the specific OAuth provider by both provider_id and account_id
    const matchingProvider = user.oauth_providers.find(
      p => p.id === params.provider_id && p.account_id === params.provider_account_id
    );
    if (!matchingProvider) {
      throw new KnownErrors.OAuthConnectionNotConnectedToUser();
    }

    const providerInstance = await getProvider(provider);

    // ====================== retrieve access token if it exists ======================
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    // Find the specific oauth account by provider_id and provider_account_id
    const oauthAccount = await prisma.projectUserOAuthAccount.findFirst({
      where: {
        tenancyId: auth.tenancy.id,
        projectUserId: params.user_id,
        configOAuthProviderId: params.provider_id,
        providerAccountId: params.provider_account_id,
        allowConnectedAccounts: true,
      },
    });

    if (!oauthAccount) {
      throw new KnownErrors.OAuthConnectionNotConnectedToUser();
    }

    const accessTokens = await prisma.oAuthAccessToken.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        oauthAccountId: oauthAccount.id,
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
        oauthAccountId: oauthAccount.id,
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
      let tokenSetResult: Result<TokenSet, string>;
      try {
        tokenSetResult = await providerInstance.getAccessToken({
          refreshToken: token.refreshToken,
          scope: data.scope,
        });
      } catch (error) {
        // Unexpected errors (not handled by the provider) are logged and we continue to the next token
        captureError('oauth-access-token-refresh-unexpected-error', new StackAssertionError('Unexpected error refreshing access token — this may indicate a bug or misconfiguration', {
          error,
          tenancyId: auth.tenancy.id,
          providerId: params.provider_id,
          providerAccountId: params.provider_account_id,
          userId: params.user_id,
          scope: data.scope,
        }));

        tokenSetResult = Result.error("Unexpected error refreshing access token");
      }

      if (tokenSetResult.status === "error") {
        await prisma.oAuthToken.update({
          where: { id: token.id },
          data: { isValid: false },
        });

        continue;
      }

      const tokenSet = tokenSetResult.data;
      if (tokenSet.accessToken) {
        await prisma.oAuthAccessToken.create({
          data: {
            tenancyId: auth.tenancy.id,
            accessToken: tokenSet.accessToken,
            oauthAccountId: oauthAccount.id,
            scopes: token.scopes,
            expiresAt: tokenSet.accessTokenExpiredAt
          }
        });

        if (tokenSet.refreshToken) {
          // mark the old token as invalid, add the new token to the DB
          const oldToken = token;
          await prisma.oAuthToken.update({
            where: { id: oldToken.id },
            data: { isValid: false },
          });
          await prisma.oAuthToken.create({
            data: {
              tenancyId: auth.tenancy.id,
              refreshToken: tokenSet.refreshToken,
              oauthAccountId: oauthAccount.id,
              scopes: oldToken.scopes,
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
