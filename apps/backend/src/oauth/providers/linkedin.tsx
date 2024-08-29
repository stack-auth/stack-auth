import { OAuthBaseProvider, TokenSet } from "./base";
import { OAuthUserInfo, validateUserInfo } from "../utils";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";

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
        issuer: "https://linkedin.com",
        authorizationEndpoint: "https://linkedin.com/oauth/v2/authorization",
        tokenEndpoint: "https://linkedin.com/oauth/v2/accessToken",
        redirectUri:
          getEnvVariable("STACK_BASE_URL") +
          "/api/v1/auth/oauth/callback/linkedin",
        baseScope: "openid profile email",
        authorizationExtraParams: {
          grant_type: "authorization_code",
        },
        ...options,
      }))
    );
  }
  async postProcessUserInfo(tokenSet: TokenSet): Promise<OAuthUserInfo> {
    /*
    Sign In with LinkedIn using OpenID Connect
    https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2?context=linkedin%2Fconsumer%2Fcontext
    */
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
}
