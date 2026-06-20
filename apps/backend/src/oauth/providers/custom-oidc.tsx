import { OAuthUserInfo, validateUserInfo } from "../utils";
import { OAuthBaseProvider, TokenSet } from "./base";

export class CustomOidcProvider extends OAuthBaseProvider {
  private constructor(
    private readonly trustEmailVerified: boolean,
    ...args: ConstructorParameters<typeof OAuthBaseProvider>
  ) {
    super(...args);
  }

  static async create(options: {
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    issuerUrl: string,
    scope?: string,
    trustEmailVerified?: boolean,
  }) {
    const { redirectUri, issuerUrl, scope, trustEmailVerified, ...rest } = options;
    return new CustomOidcProvider(!!trustEmailVerified, ...await OAuthBaseProvider.createConstructorArgs({
      discoverFromUrl: issuerUrl,
      redirectUri,
      baseScope: scope || "openid email profile",
      openid: true,
      ...rest,
    }));
  }

  async postProcessUserInfo(tokenSet: TokenSet): Promise<OAuthUserInfo> {
    const rawUserInfo = await this.oauthClient.userinfo(tokenSet.accessToken);
    return validateUserInfo({
      accountId: rawUserInfo.sub,
      displayName: rawUserInfo.name ?? rawUserInfo.preferred_username ?? null,
      email: rawUserInfo.email ?? null,
      profileImageUrl: rawUserInfo.picture ?? null,
      // Trust the admin's "treat emails as verified" toggle when the provider omits the claim.
      emailVerified: !!rawUserInfo.email_verified || this.trustEmailVerified,
    });
  }

  async checkAccessTokenValidity(accessToken: string): Promise<boolean> {
    try {
      const response = await this.oauthClient.userinfo(accessToken);
      return !!response.sub;
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
