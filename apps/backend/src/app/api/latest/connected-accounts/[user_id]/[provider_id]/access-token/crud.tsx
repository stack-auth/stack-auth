import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import { getProvider } from "@/oauth";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { connectedAccountAccessTokenCrud } from "@stackframe/stack-shared/dist/interface/crud/oauth";
import { userIdOrMeSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { extractScopes } from "@stackframe/stack-shared/dist/utils/strings";


export const connectedAccountAccessTokenCrudHandlers = createLazyProxy(() =>createCrudHandlers(connectedAccountAccessTokenCrud, {
  paramsSchema: yupObject({
    provider_id: yupString().defined(),
    user_id: userIdOrMeSchema.defined(),
  }),
  async onCreate({ auth, data, params }) {
    if (auth.type === 'client' && auth.user?.id !== params.user_id) {
      throw new StatusError(StatusError.Forbidden, "Client can only access its own connected accounts");
    }

    const provider = auth.tenancy.config.oauth_providers.find((p) => p.id === params.provider_id);
    if (!provider) {
      throw new KnownErrors.OAuthProviderNotFoundOrNotEnabled();
    }

    if (provider.type === 'shared') {
      throw new KnownErrors.OAuthAccessTokenNotAvailableWithSharedOAuthKeys();
    }

    const user = await usersCrudHandlers.adminRead({ tenancy: auth.tenancy, user_id: params.user_id });
    if (!user.oauth_providers.map(x => x.id).includes(params.provider_id)) {
      throw new KnownErrors.OAuthConnectionNotConnectedToUser();
    }

    const providerInstance = await getProvider(provider);

    // ====================== retrieve access token if it exists ======================
    const prisma = getPrismaClientForTenancy(auth.tenancy);
    const accessTokens = await prisma.oAuthAccessToken.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        configOAuthProviderId: params.provider_id,
        projectUserOAuthAccount: {
          projectUserId: params.user_id,
        },
        expiresAt: {
          // is at least 5 minutes in the future
          gt: new Date(Date.now() + 5 * 60 * 1000),
        },
      },
    });
    const filteredTokens = accessTokens.filter((t) => {
      return extractScopes(data.scope || "").every((scope) => t.scopes.includes(scope));
    });
    if (filteredTokens.length !== 0) {
      const token = filteredTokens[0].accessToken;
      // some providers (particularly GitHub) invalidate access tokens on the server-side, in which case we want to request a new access token
      if (await providerInstance.checkAccessTokenValidity(token)) {
        return { access_token: token };
      }
    }

    // ============== no valid access token found, try to refresh the token ==============

    const refreshTokens = await prisma.oAuthToken.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        configOAuthProviderId: params.provider_id,
        projectUserOAuthAccount: {
          projectUserId: params.user_id,
        }
      },
    });

    const filteredRefreshTokens = refreshTokens.filter((t) => {
      return extractScopes(data.scope || "").every((scope) => t.scopes.includes(scope));
    });

    if (filteredRefreshTokens.length === 0) {
      throw new KnownErrors.OAuthConnectionDoesNotHaveRequiredScope();
    }

    const tokenSet = await providerInstance.getAccessToken({
      refreshToken: filteredRefreshTokens[0].refreshToken,
      scope: data.scope,
    });

    if (!tokenSet.accessToken) {
      throw new StackAssertionError("No access token returned");
    }

    await prisma.oAuthAccessToken.create({
      data: {
        tenancyId: auth.tenancy.id,
        configOAuthProviderId: params.provider_id,
        accessToken: tokenSet.accessToken,
        providerAccountId: filteredRefreshTokens[0].providerAccountId,
        scopes: filteredRefreshTokens[0].scopes,
        expiresAt: tokenSet.accessTokenExpiredAt
      }
    });

    if (tokenSet.refreshToken) {
      // remove the old token, add the new token to the DB
      await prisma.oAuthToken.deleteMany({
        where: {
          refreshToken: filteredRefreshTokens[0].refreshToken,
        },
      });
      await prisma.oAuthToken.create({
        data: {
          tenancyId: auth.tenancy.id,
          configOAuthProviderId: params.provider_id,
          refreshToken: tokenSet.refreshToken,
          providerAccountId: filteredRefreshTokens[0].providerAccountId,
          scopes: filteredRefreshTokens[0].scopes,
        }
      });
    }

    return { access_token: tokenSet.accessToken };
  },
}));


