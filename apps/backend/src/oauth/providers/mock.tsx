import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { OAuthUserInfo, validateUserInfo } from "../utils";
import { OAuthBaseProvider, TokenSet } from "./base";

export class MockProvider extends OAuthBaseProvider {
  constructor(
    ...args: ConstructorParameters<typeof OAuthBaseProvider>
  ) {
    super(...args);
  }

  static async create(providerId: string, options: { redirectUri: string }) {
    return new MockProvider(...await OAuthBaseProvider.createConstructorArgs({
      discoverFromUrl: getEnvVariable("STACK_OAUTH_MOCK_URL"),
      redirectUri: options.redirectUri,
      baseScope: "openid offline_access",
      openid: true,
      clientId: providerId,
      clientSecret: "MOCK-SERVER-SECRET",
    }));
  }

  async postProcessUserInfo(tokenSet: TokenSet): Promise<OAuthUserInfo> {
    const rawUserInfo = await this.oauthClient.userinfo(tokenSet.accessToken);

    return validateUserInfo({
      accountId: rawUserInfo.sub,
      displayName: rawUserInfo.name,
      email: rawUserInfo.sub,
      profileImageUrl: rawUserInfo.picture,
      emailVerified: true,
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
