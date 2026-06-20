import { OAuthUserInfo, validateUserInfo } from "../utils";
import { OAuthBaseProvider, TokenSet } from "./base";

/**
 * Generic OAuth 2.0 (non-OIDC) provider. Unlike {@link CustomOidcProvider},
 * it does not use OIDC discovery and has no ID token; the authorize, token and
 * userinfo endpoints are configured explicitly and the user profile is read
 * from the userinfo endpoint response with best-effort claim mapping.
 */
export class CustomOAuthProvider extends OAuthBaseProvider {
  private constructor(
    ...args: ConstructorParameters<typeof OAuthBaseProvider>
  ) {
    super(...args);
  }

  static async create(options: {
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    authorizationEndpoint: string,
    tokenEndpoint: string,
    userinfoEndpoint: string,
    scope?: string,
  }) {
    const { redirectUri, authorizationEndpoint, tokenEndpoint, userinfoEndpoint, scope, ...rest } = options;
    return new CustomOAuthProvider(...await OAuthBaseProvider.createConstructorArgs({
      issuer: new URL(authorizationEndpoint).origin,
      authorizationEndpoint,
      tokenEndpoint,
      userinfoEndpoint,
      redirectUri,
      baseScope: scope || "",
      openid: false,
      ...rest,
    }));
  }

  async postProcessUserInfo(tokenSet: TokenSet): Promise<OAuthUserInfo> {
    const rawUserInfo: Record<string, any> = await this.oauthClient.userinfo(tokenSet.accessToken);
    const accountId = rawUserInfo.sub ?? rawUserInfo.id ?? rawUserInfo.user_id;
    return validateUserInfo({
      accountId: accountId != null ? String(accountId) : undefined,
      displayName: rawUserInfo.name ?? rawUserInfo.preferred_username ?? rawUserInfo.login ?? rawUserInfo.username ?? null,
      email: rawUserInfo.email ?? null,
      profileImageUrl: rawUserInfo.picture ?? rawUserInfo.avatar_url ?? null,
      emailVerified: !!(rawUserInfo.email_verified ?? rawUserInfo.verified_email),
    });
  }

  async checkAccessTokenValidity(accessToken: string): Promise<boolean> {
    try {
      const response: Record<string, any> = await this.oauthClient.userinfo(accessToken);
      return !!(response.sub ?? response.id ?? response.user_id);
    } catch (error: any) {
      // Only treat definitive auth failures (401/403) as "invalid token".
      // Rethrow network/transient errors so callers don't persist false-negative validity.
      if (error?.status === 401 || error?.status === 403 || error?.code === "invalid_token") {
        return false;
      }
      throw error;
    }
  }
}
