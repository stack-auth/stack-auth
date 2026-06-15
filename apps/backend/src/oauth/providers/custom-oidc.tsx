import { OAuthUserInfo, validateUserInfo } from "../utils";
import { OAuthBaseProvider, TokenSet } from "./base";

export class CustomOidcProvider extends OAuthBaseProvider {
  private constructor(
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
  }) {
    const { redirectUri, issuerUrl, scope, ...rest } = options;
    return new CustomOidcProvider(...await OAuthBaseProvider.createConstructorArgs({
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
      emailVerified: !!rawUserInfo.email_verified,
    });
  }

  async checkAccessTokenValidity(accessToken: string): Promise<boolean> {
    try {
      const response = await this.oauthClient.userinfo(accessToken);
      return !!response.sub;
    } catch (error) {
      return false;
    }
  }
}
