import { OAuthBaseProvider, TokenSet } from "@/oauth/providers/base";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { KnownErrors } from "@stackframe/stack-shared";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { extractScopes } from "@stackframe/stack-shared/dist/utils/strings";

/**
 * Access tokens minted under Stack Auth's shared OAuth apps must not be handed
 * to clients — they carry Stack Auth's brand at the provider. Only allowed when
 * the deployer explicitly opts in via STACK_ALLOW_SHARED_OAUTH_ACCESS_TOKENS.
 * NOT gated on NODE_ENV — the env-var opt-in is the only escape hatch.
 */
export function isSharedAccessTokenBlocked(providerIsShared: boolean): boolean {
  if (!providerIsShared) return false;
  return getEnvVariable("STACK_ALLOW_SHARED_OAUTH_ACCESS_TOKENS", "") !== "true";
}

import.meta.vitest?.describe("isSharedAccessTokenBlocked", () => {
  const { test, expect, beforeEach, afterEach, vi } = import.meta.vitest!;
  beforeEach(() => {
    vi.stubEnv("STACK_ALLOW_SHARED_OAUTH_ACCESS_TOKENS", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("non-shared provider is never blocked, regardless of env var", () => {
    expect(isSharedAccessTokenBlocked(false)).toBe(false);
    vi.stubEnv("STACK_ALLOW_SHARED_OAUTH_ACCESS_TOKENS", "true");
    expect(isSharedAccessTokenBlocked(false)).toBe(false);
  });

  test("shared provider is blocked when env var is unset or empty", () => {
    expect(isSharedAccessTokenBlocked(true)).toBe(true);
  });

  test("shared provider is blocked for any value other than the literal 'true'", () => {
    for (const v of ["false", "1", "TRUE", "yes", " true "]) {
      vi.stubEnv("STACK_ALLOW_SHARED_OAUTH_ACCESS_TOKENS", v);
      expect(isSharedAccessTokenBlocked(true)).toBe(true);
    }
  });

  test("shared provider is allowed only when env var === 'true'", () => {
    vi.stubEnv("STACK_ALLOW_SHARED_OAUTH_ACCESS_TOKENS", "true");
    expect(isSharedAccessTokenBlocked(true)).toBe(false);
  });

  test("result does not depend on NODE_ENV", () => {
    for (const nodeEnv of ["production", "development", "test", "preview", ""]) {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("STACK_ALLOW_SHARED_OAUTH_ACCESS_TOKENS", "");
      expect(isSharedAccessTokenBlocked(true)).toBe(true);
      vi.stubEnv("STACK_ALLOW_SHARED_OAUTH_ACCESS_TOKENS", "true");
      expect(isSharedAccessTokenBlocked(true)).toBe(false);
    }
  });
});

/**
 * Retrieves a valid access token for one or more OAuth accounts, or refreshes one if needed.
 *
 * When multiple account IDs are provided (legacy per-provider endpoint), tokens are searched
 * across all accounts. When a single ID is provided (per-account endpoint), only that account
 * is checked.
 */
export async function retrieveOrRefreshAccessToken(options: {
  prisma: Awaited<ReturnType<typeof getPrismaClientForTenancy>>,
  providerInstance: OAuthBaseProvider,
  tenancyId: string,
  oauthAccountIds: string[],
  scope: string | undefined,
  errorContext: Record<string, unknown>,
}): Promise<{ access_token: string }> {
  const { prisma, providerInstance, tenancyId, oauthAccountIds, scope, errorContext } = options;
  const accountIdFilter = oauthAccountIds.length === 1
    ? { oauthAccountId: oauthAccountIds[0] }
    : { oauthAccountId: { in: oauthAccountIds } };

  // ====================== retrieve access token if it exists ======================
  const accessTokens = await prisma.oAuthAccessToken.findMany({
    where: {
      tenancyId,
      ...accountIdFilter,
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
      ...accountIdFilter,
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
          oauthAccountId: token.oauthAccountId,
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
            oauthAccountId: token.oauthAccountId,
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
