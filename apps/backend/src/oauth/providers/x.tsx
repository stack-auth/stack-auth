import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { OAuthUserInfo, validateUserInfo } from "../utils";
import { OAuthBaseProvider, TokenSet } from "./base";

export class XProvider extends OAuthBaseProvider {
  private constructor(
    ...args: ConstructorParameters<typeof OAuthBaseProvider>
  ) {
    super(...args);
  }

  static async create(options: { clientId: string, clientSecret: string }) {
    return new XProvider(
      ...(await OAuthBaseProvider.createConstructorArgs({
        issuer: "https://twitter.com",
        authorizationEndpoint: "https://twitter.com/i/oauth2/authorize",
        tokenEndpoint: "https://api.x.com/2/oauth2/token",
        redirectUri: getEnvVariable("NEXT_PUBLIC_STACK_API_URL") + "/api/v1/auth/oauth/callback/x",
        baseScope: "users.read offline.access tweet.read",
        ...options,
      }))
    );
  }

  async postProcessUserInfo(tokenSet: TokenSet): Promise<OAuthUserInfo> {
    const fetchRes = await fetch(
      "https://api.x.com/2/users/me?user.fields=id,name,profile_image_url",
      {
        headers: {
          Authorization: `Bearer ${tokenSet.accessToken}`,
        },
      }
    );
    if (!fetchRes.ok) {
      const text = await fetchRes.text();
      throw new StackAssertionError(`Failed to fetch user info from X: ${fetchRes.status} ${text}`, {
        status: fetchRes.status,
        text,
      });
    }
    const json = await fetchRes.json();
    const userInfo = json.data;

    return validateUserInfo({
      accountId: userInfo?.id?.toString(),
      displayName: userInfo?.name || userInfo?.username,
      email: null, // There is no way of getting email from X OAuth2.0 API
      profileImageUrl: userInfo?.profile_image_url as any,
      emailVerified: false,
    });
  }

  async checkAccessTokenValidity(accessToken: string): Promise<boolean> {
    const res = await fetch("https://api.x.com/2/users/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return res.ok;
  }
}
