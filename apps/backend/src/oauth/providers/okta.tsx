import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { OAuthUserInfo, validateUserInfo } from "../utils";
import { OAuthBaseProvider, TokenSet } from "./base";

export class OktaProvider extends OAuthBaseProvider {
  private constructor(
    ...args: ConstructorParameters<typeof OAuthBaseProvider>
  ) {
    super(...args);
  }

  static async create(options: {
    clientId: string,
    clientSecret: string,
    issuerUrl?: string,
  }) {
    return new OktaProvider(
      ...(await OAuthBaseProvider.createConstructorArgs({
        discoverFromUrl: options.issuerUrl || throwErr("Okta issuer URL is required"),
        redirectUri: getEnvVariable("NEXT_PUBLIC_STACK_API_URL") + `/api/v1/auth/oauth/callback/okta`,
        baseScope: "openid profile email",
        openid: true,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
      }))
    );
  }

  async postProcessUserInfo(tokenSet: TokenSet): Promise<OAuthUserInfo> {
    const rawUserInfo = await this.oauthClient.userinfo(tokenSet.accessToken);

    return validateUserInfo({
      accountId: rawUserInfo.sub,
      displayName: rawUserInfo.name || rawUserInfo.preferred_username,
      email: rawUserInfo.email,
      profileImageUrl: rawUserInfo.picture,
      emailVerified: rawUserInfo.email_verified,
    });
  }

  async checkAccessTokenValidity(accessToken: string): Promise<boolean> {
    try {
      const issuerUrl = this.oauthClient.issuer.metadata.issuer;
      const res = await fetch(`${issuerUrl}/oauth2/v1/userinfo`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return res.ok;
    } catch (error) {
      return false;
    }
  }
}
