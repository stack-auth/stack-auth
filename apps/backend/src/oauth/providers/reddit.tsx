import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { OAuthUserInfo, validateUserInfo } from "../utils";
import { OAuthBaseProvider, TokenSet } from "./base";

export class RedditProvider extends OAuthBaseProvider {
  private constructor(
    ...args: ConstructorParameters<typeof OAuthBaseProvider>
  ) {
    super(...args);
  }

  static async create(options: {
    clientId: string,
    clientSecret: string,
  }) {
    return new RedditProvider(...await OAuthBaseProvider.createConstructorArgs({
      issuer: "https://www.reddit.com",
      authorizationEndpoint: "https://www.reddit.com/api/v1/authorize",
      tokenEndpoint: "https://www.reddit.com/api/v1/access_token",
      redirectUri: getEnvVariable("NEXT_PUBLIC_STACK_API_URL") + "/api/v1/auth/oauth/callback/reddit",
      baseScope: "identity",
      defaultAccessTokenExpiresInMillis: 1000 * 60 * 60,
      tokenEndpointAuthMethod: "client_secret_basic",
      ...options,
    }));
  }

  async postProcessUserInfo(tokenSet: TokenSet): Promise<OAuthUserInfo> {
    const rawUserInfoRes = await fetch("https://oauth.reddit.com/api/v1/me", {
      headers: {
        Authorization: `Bearer ${tokenSet.accessToken}`,
        "User-Agent": "StackAuth/1.0",
      },
    });
    if (!rawUserInfoRes.ok) {
      throw new Error("Error fetching user info from Reddit provider: Status code " + rawUserInfoRes.status);
    }
    const rawUserInfo = await rawUserInfoRes.json();
    return validateUserInfo({
      accountId: rawUserInfo.id,
      displayName: rawUserInfo.name,
      email: rawUserInfo.email,
      profileImageUrl: rawUserInfo.icon_img || rawUserInfo.snoovatar_img,
      emailVerified: rawUserInfo.has_verified_email || false,
    });
  }

  async checkAccessTokenValidity(accessToken: string): Promise<boolean> {
    const res = await fetch("https://oauth.reddit.com/api/v1/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "StackAuth/1.0",
      },
    });
    return res.ok;
  }
}
