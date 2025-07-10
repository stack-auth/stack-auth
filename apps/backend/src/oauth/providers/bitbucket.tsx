import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { OAuthUserInfo, validateUserInfo } from "../utils";
import { OAuthBaseProvider, TokenSet } from "./base";

export class BitbucketProvider extends OAuthBaseProvider {
  private constructor(
    ...args: ConstructorParameters<typeof OAuthBaseProvider>
  ) {
    super(...args);
  }

  static async create(options: { clientId: string, clientSecret: string }) {
    return new BitbucketProvider(
      ...(await OAuthBaseProvider.createConstructorArgs({
        issuer: "https://bitbucket.org",
        authorizationEndpoint: "https://bitbucket.org/site/oauth2/authorize",
        tokenEndpoint: "https://bitbucket.org/site/oauth2/access_token",
        redirectUri: getEnvVariable("NEXT_PUBLIC_STACK_API_URL") + "/api/v1/auth/oauth/callback/bitbucket",
        baseScope: "account email",
        ...options,
      }))
    );
  }

  async postProcessUserInfo(tokenSet: TokenSet): Promise<OAuthUserInfo> {
    const headers = {
      Authorization: `Bearer ${tokenSet.accessToken}`,
    };
    const [userInfo, emailData] = await Promise.all([
      fetch("https://api.bitbucket.org/2.0/user", { headers }).then((res) =>
        res.json()
      ),
      fetch("https://api.bitbucket.org/2.0/user/emails", { headers }).then(
        (res) => res.json()
      ),
    ]);

    return validateUserInfo({
      accountId: userInfo.account_id,
      displayName: userInfo.display_name,
      email: emailData?.values[0].email,
      profileImageUrl: userInfo.links.avatar.href,
      emailVerified: emailData?.values[0].is_confirmed,
    });
  }

  async checkAccessTokenValidity(accessToken: string): Promise<boolean> {
    const res = await fetch("https://api.bitbucket.org/2.0/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return res.ok;
  }
}
