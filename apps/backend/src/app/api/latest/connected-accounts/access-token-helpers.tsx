import { OAuthBaseProvider, TokenSet } from "@/oauth/providers/base";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { KnownErrors } from "@stackframe/stack-shared";
import { StackAssertionError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { extractScopes } from "@stackframe/stack-shared/dist/utils/strings";

/**
 * Retrieves a valid access token for a given OAuth account, or refreshes one if needed.
 *
 * This is the shared core logic used by both the legacy per-provider endpoint
 * and the new per-account endpoint.
 */
export async function retrieveOrRefreshAccessToken(options: {
  prisma: Awaited<ReturnType<typeof getPrismaClientForTenancy>>,
  providerInstance: OAuthBaseProvider,
  tenancyId: string,
  oauthAccountId: string,
  scope: string | undefined,
  errorContext: Record<string, unknown>,
}): Promise<{ access_token: string }> {
  const { prisma, providerInstance, tenancyId, oauthAccountId, scope, errorContext } = options;

  // ====================== retrieve access token if it exists ======================
  const accessTokens = await prisma.oAuthAccessToken.findMany({
    where: {
      tenancyId,
      oauthAccountId,
      expiresAt: {
        gt: new Date(Date.now() + 5 * 60 * 1000),
      },
      isValid: true,
    },
  });
  const filteredTokens = accessTokens.filter((t) => {
    return extractScopes(scope || "").every((s) => t.scopes.includes(s));
  });
  for (const token of filteredTokens) {
    if (await providerInstance.checkAccessTokenValidity(token.accessToken)) {
      return { access_token: token.accessToken };
    } else {
      await prisma.oAuthAccessToken.update({
        where: { id: token.id },
        data: { isValid: false },
      });
    }
  }

  // ============== no valid access token found, try to refresh the token ==============
  const refreshTokens = await prisma.oAuthToken.findMany({
    where: {
      tenancyId,
      oauthAccountId,
      isValid: true,
    },
  });

  const filteredRefreshTokens = refreshTokens.filter((t) => {
    return extractScopes(scope || "").every((s) => t.scopes.includes(s));
  });

  if (filteredRefreshTokens.length === 0) {
    throw new KnownErrors.OAuthConnectionDoesNotHaveRequiredScope();
  }

  for (const token of filteredRefreshTokens) {
    let tokenSetResult: Result<TokenSet, string>;
    try {
      tokenSetResult = await providerInstance.getAccessToken({
        refreshToken: token.refreshToken,
        scope,
      });
    } catch (error) {
      captureError('oauth-access-token-refresh-unexpected-error', new StackAssertionError('Unexpected error refreshing access token — this may indicate a bug or misconfiguration', {
        error,
        ...errorContext,
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
          tenancyId,
          accessToken: tokenSet.accessToken,
          oauthAccountId,
          scopes: token.scopes,
          expiresAt: tokenSet.accessTokenExpiredAt,
        },
      });

      if (tokenSet.refreshToken) {
        await prisma.oAuthToken.update({
          where: { id: token.id },
          data: { isValid: false },
        });
        await prisma.oAuthToken.create({
          data: {
            tenancyId,
            refreshToken: tokenSet.refreshToken,
            oauthAccountId,
            scopes: token.scopes,
          },
        });
      }

      return { access_token: tokenSet.accessToken };
    } else {
      throw new StackAssertionError("No access token returned");
    }
  }

  throw new KnownErrors.OAuthConnectionDoesNotHaveRequiredScope();
}
