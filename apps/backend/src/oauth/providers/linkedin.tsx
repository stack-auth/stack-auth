import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { OAuthUserInfo, validateUserInfo } from "../utils";
import { OAuthBaseProvider, TokenSet } from "./base";

// Note: Need to install Sign In with LinkedIn using OpenID Connect from product section in app list.

export class LinkedInProvider extends OAuthBaseProvider {
  private constructor(
    ...args: ConstructorParameters<typeof OAuthBaseProvider>
  ) {
    super(...args);
  }

  static async create(options: { clientId: string, clientSecret: string }) {
    return new LinkedInProvider(
      ...(await OAuthBaseProvider.createConstructorArgs({
        issuer: "https://www.linkedin.com/oauth",
        authorizationEndpoint: "https://www.linkedin.com/oauth/v2/authorization",
        tokenEndpoint: "https://www.linkedin.com/oauth/v2/accessToken",
        redirectUri: getEnvVariable("NEXT_PUBLIC_STACK_API_URL") + "/api/v1/auth/oauth/callback/linkedin",
        baseScope: "openid profile email",
        openid: true,
        jwksUri: "https://www.linkedin.com/oauth/openid/jwks",
        tokenEndpointAuthMethod: "client_secret_post",
        noPKCE: true,
        ...options,
      }))
    );
  }
  async postProcessUserInfo(tokenSet: TokenSet): Promise<OAuthUserInfo> {
    const userInfo = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenSet.accessToken}` },
    }).then((res) => res.json());

    return validateUserInfo({
      accountId: userInfo.sub,
      displayName: userInfo.name,
      email: userInfo.email,
      profileImageUrl: userInfo.picture,
      emailVerified: userInfo.email_verified,
    });
  }

  async checkAccessTokenValidity(accessToken: string): Promise<boolean> {
    const res = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res.ok;
  }
}
