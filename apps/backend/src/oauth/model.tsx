import { createMfaRequiredError } from "@/app/api/latest/auth/mfa/sign-in/verification-code-handler";
import { checkApiKeySet } from "@/lib/internal-api-keys";
import { validateRedirectUrl } from "@/lib/redirect-urls";
import { getSoleTenancyFromProjectBranch, getTenancy } from "@/lib/tenancies";
import { decodeAccessToken, generateAccessToken } from "@/lib/tokens";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { AuthorizationCode, AuthorizationCodeModel, Client, Falsey, RefreshToken, Token, User } from "@node-oauth/oauth2-server";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { KnownErrors } from "@stackframe/stack-shared";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { captureError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { getProjectBranchFromClientId } from ".";

declare module "@node-oauth/oauth2-server" {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Client {}
}

const enabledScopes = ["legacy"];

function assertScopeIsValid(scope: string[]) {
  for (const s of scope) {
    if (!checkScope(s)) {
      throw new KnownErrors.InvalidScope(s);
    }
  }
}

function checkScope(scope: string | string[] | undefined) {
  if (typeof scope === "string") {
    return enabledScopes.includes(scope);
  } else if (Array.isArray(scope)){
    return scope.every((s) => enabledScopes.includes(s));
  } else {
    return false;
  }
}

export class OAuthModel implements AuthorizationCodeModel {
  async getClient(clientId: string, clientSecret: string): Promise<Client | Falsey> {
    const tenancy = await getSoleTenancyFromProjectBranch(...getProjectBranchFromClientId(clientId), true);
    if (!tenancy) {
      return false;
    }

    if (clientSecret) {
      const keySet = await checkApiKeySet(tenancy.project.id, { publishableClientKey: clientSecret });
      if (!keySet) {
        return false;
      }
    }

    let redirectUris: string[] = [];
    try {
      redirectUris = Object.entries(tenancy.config.domains.trustedDomains).map(
        ([_, domain]) => new URL(domain.handlerPath, domain.baseUrl).toString()
      );
    } catch (e) {
      captureError("get-oauth-redirect-urls", {
        error: e,
        projectId: tenancy.project.id,
        domains: tenancy.config.domains,
      });
      throw e;
    }

    if (redirectUris.length === 0 && tenancy.config.domains.allowLocalhost) {
      redirectUris.push("http://localhost");
    }

    return {
      id: tenancy.project.id,
      grants: ["authorization_code", "refresh_token"],
      redirectUris: redirectUris,
    };
  }

  async validateScope(user: User | null, client: Client | null, scope?: string[]): Promise<string[] | Falsey> {
    if (!user) {
      return false;
    }

    if (!client) {
      return false;
    }

    return checkScope(scope) ? scope : false;
  }

  async generateAccessToken(client: Client, user: User, scope: string[]): Promise<string> {
    assertScopeIsValid(scope);
    const tenancy = await getSoleTenancyFromProjectBranch(...getProjectBranchFromClientId(client.id));

    if (!user.refreshTokenId) {
      // create new refresh token
      const refreshToken = await this.generateRefreshToken(client, user, scope);
      // save it in user, then we just access it in refresh
      // HACK: This is a hack to ensure the refresh token is already there so we can associate the access token with it
      const newRefreshToken = await globalPrismaClient.projectUserRefreshToken.create({
        data: {
          refreshToken,
          tenancyId: tenancy.id,
          projectUserId: user.id,
          expiresAt: new Date(),
        },
      });
      user.refreshTokenId = newRefreshToken.id;
    }

    return await generateAccessToken({
      tenancy,
      userId: user.id,
      refreshTokenId: user.refreshTokenId ?? throwErr("Refresh token ID not found on OAuth user"),
    });
  }

  async generateRefreshToken(client: Client, user: User, scope: string[]): Promise<string> {
    assertScopeIsValid(scope);

    if (user.refreshTokenId) {
      const tenancy = await getSoleTenancyFromProjectBranch(...getProjectBranchFromClientId(client.id));
      const refreshToken = await globalPrismaClient.projectUserRefreshToken.findUniqueOrThrow({
        where: {
          tenancyId_id: {
            tenancyId: tenancy.id,
            id: user.refreshTokenId,
          },
        },
      });
      return refreshToken.refreshToken;
    }

    return generateSecureRandomString();
  }

  async saveToken(token: Token, client: Client, user: User): Promise<Token | Falsey> {
    if (token.refreshToken) {
      const tenancy = await getSoleTenancyFromProjectBranch(...getProjectBranchFromClientId(client.id));
      const prisma = await getPrismaClientForTenancy(tenancy);
      const projectUser = await prisma.projectUser.findUniqueOrThrow({
        where: {
          tenancyId_projectUserId: {
            tenancyId: tenancy.id,
            projectUserId: user.id,
          },
        },
      });
      if (projectUser.requiresTotpMfa) {
        throw await createMfaRequiredError({
          project: tenancy.project,
          branchId: tenancy.branchId,
          userId: projectUser.projectUserId,
          isNewUser: false,
        });
      }


      await globalPrismaClient.projectUserRefreshToken.upsert({
        where: {
          tenancyId_id: {
            tenancyId: tenancy.id,
            id: user.refreshTokenId,
          },
        },
        update: {
          refreshToken: token.refreshToken,
          expiresAt: token.refreshTokenExpiresAt,
        },
        create: {
          refreshToken: token.refreshToken,
          tenancyId: tenancy.id,
          projectUserId: user.id,
        },
      });
    }

    token.client = client;
    token.user = user;
    return {
      accessToken: token.accessToken,
      accessTokenExpiresAt: token.accessTokenExpiresAt,
      refreshToken: token.refreshToken,
      refreshTokenExpiresAt: token.refreshTokenExpiresAt,
      scope: token.scope,
      client: token.client,
      user: token.user,

      // TODO remove deprecated camelCase properties
      newUser: user.newUser,
      is_new_user: user.newUser,
      afterCallbackRedirectUrl: user.afterCallbackRedirectUrl,
      after_callback_redirect_url: user.afterCallbackRedirectUrl,
    };
  }

  async getAccessToken(accessToken: string): Promise<Token | Falsey> {
    const result = await decodeAccessToken(accessToken);
    if (result.status === "error") {
      captureError("getAccessToken", result.error);
      return false;
    }
    const decoded = result.data;

    return {
      accessToken,
      accessTokenExpiresAt: new Date(decoded.exp * 1000),
      user: {
        id: decoded.userId,
      },
      client: {
        id: decoded.projectId,
        grants: ["authorization_code", "refresh_token"],
      },
      scope: enabledScopes,
    };
  }

  async getRefreshToken(refreshToken: string): Promise<RefreshToken | Falsey> {
    const token = await globalPrismaClient.projectUserRefreshToken.findUnique({
      where: {
        refreshToken,
      },
    });

    if (!token) {
      return false;
    }

    const tenancy = await getTenancy(token.tenancyId);

    if (!tenancy) {
      return false;
    }

    return {
      refreshToken,
      refreshTokenExpiresAt: token.expiresAt === null ? undefined : token.expiresAt,
      user: {
        id: token.projectUserId,
        refreshTokenId: token.id,
      },
      client: {
        id: tenancy.project.id,
        grants: ["authorization_code", "refresh_token"],
      },
      scope: enabledScopes,
    };
  }

  async revokeToken(token: RefreshToken): Promise<boolean> {
    // No refreshToken rotation for now (see Git history for old code)
    return true;
  }

  async verifyScope(token: Token, scope: string[]): Promise<boolean> {
    return checkScope(scope);
  }

  async saveAuthorizationCode(
    code: Pick<AuthorizationCode, 'authorizationCode' | 'expiresAt' | 'redirectUri' | 'scope' | 'codeChallenge' | 'codeChallengeMethod'>,
    client: Client,
    user: User
  ): Promise<AuthorizationCode | Falsey> {
    if (!code.scope) {
      throw new KnownErrors.InvalidScope("<empty string>");
    }
    assertScopeIsValid(code.scope);
    const tenancy = await getSoleTenancyFromProjectBranch(...getProjectBranchFromClientId(client.id));

    if (!validateRedirectUrl(code.redirectUri, tenancy)) {
      throw new KnownErrors.RedirectUrlNotWhitelisted();
    }

    await globalPrismaClient.projectUserAuthorizationCode.create({
      data: {
        authorizationCode: code.authorizationCode,
        codeChallenge: code.codeChallenge || "",
        codeChallengeMethod: code.codeChallengeMethod || "",
        redirectUri: code.redirectUri,
        expiresAt: code.expiresAt,
        projectUserId: user.id,
        newUser: user.newUser,
        afterCallbackRedirectUrl: user.afterCallbackRedirectUrl,
        tenancyId: tenancy.id,
      },
    });

    return {
      authorizationCode: code.authorizationCode,
      expiresAt: code.expiresAt,
      redirectUri: code.redirectUri,
      scope: enabledScopes,
      client: {
        id: client.id,
        grants: ["authorization_code", "refresh_token"],
      },
      user,
    };
  }

  async getAuthorizationCode(authorizationCode: string): Promise<AuthorizationCode | Falsey> {
    const code = await globalPrismaClient.projectUserAuthorizationCode.findUnique({
      where: {
        authorizationCode,
      },
    });

    if (!code) {
      return false;
    }

    const tenancy = await getTenancy(code.tenancyId);

    if (!tenancy) {
      return false;
    }
    return {
      authorizationCode: code.authorizationCode,
      expiresAt: code.expiresAt,
      redirectUri: code.redirectUri,
      scope: enabledScopes,
      codeChallenge: code.codeChallenge,
      codeChallengeMethod: code.codeChallengeMethod,
      client: {
        id: tenancy.project.id,
        grants: ["authorization_code", "refresh_token"],
      },
      user: {
        id: code.projectUserId,
        newUser: code.newUser,
        afterCallbackRedirectUrl: code.afterCallbackRedirectUrl,
      },
    };
  }

  async revokeAuthorizationCode(code: AuthorizationCode): Promise<boolean> {
    try {
      const deletedCode = await globalPrismaClient.projectUserAuthorizationCode.delete({
        where: {
          authorizationCode: code.authorizationCode,
        },
      });

      return !!deletedCode;
    } catch (error) {
      if (!(error instanceof PrismaClientKnownRequestError)) {
        throw error;
      }
      return false;
    }
  }

  async validateRedirectUri(redirect_uri: string, client: Client): Promise<boolean> {
    const tenancy = await getSoleTenancyFromProjectBranch(...getProjectBranchFromClientId(client.id));

    return validateRedirectUrl(redirect_uri, tenancy);
  }
}
