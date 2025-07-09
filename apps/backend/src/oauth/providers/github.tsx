import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { OAuthUserInfo, validateUserInfo } from "../utils";
import { OAuthBaseProvider, TokenSet } from "./base";

export class GithubProvider extends OAuthBaseProvider {
  private constructor(
    ...args: ConstructorParameters<typeof OAuthBaseProvider>
  ) {
    super(...args);
  }

  static async create(options: {
    clientId: string,
    clientSecret: string,
  }) {
    return new GithubProvider(...await OAuthBaseProvider.createConstructorArgs({
      issuer: "https://github.com",
      authorizationEndpoint: "https://github.com/login/oauth/authorize",
      tokenEndpoint: "https://github.com/login/oauth/access_token",
      userinfoEndpoint: "https://api.github.com/user",
      redirectUri: getEnvVariable("NEXT_PUBLIC_STACK_API_URL") + "/api/v1/auth/oauth/callback/github",
      baseScope: "user:email",
      // GitHub token does not expire except for lack of use in a year
      // We set a default of 1 year
      // https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation#user-token-expired-due-to-github-app-configuration
      defaultAccessTokenExpiresInMillis: 1000 * 60 * 60 * 8, // 8 hours
      ...options,
    }));
  }

  async postProcessUserInfo(tokenSet: TokenSet): Promise<OAuthUserInfo> {
    const rawUserInfoRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenSet.accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!rawUserInfoRes.ok) {
      throw new StackAssertionError("Error fetching user info from GitHub provider: Status code " + rawUserInfoRes.status, {
        rawUserInfoRes,
        hasAccessToken: !!tokenSet.accessToken,
        hasRefreshToken: !!tokenSet.refreshToken,
        accessTokenExpiredAt: tokenSet.accessTokenExpiredAt,
      });
    }
    const rawUserInfo = await rawUserInfoRes.json();

    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${tokenSet.accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!emailsRes.ok) {
      throw new StackAssertionError("Error fetching user emails from GitHub: Status code " + emailsRes.status, {
        emailsRes,
        rawUserInfo,
      });
    }
    const emails = await emailsRes.json();
    if (!Array.isArray(emails)) {
      throw new StackAssertionError("Error fetching user emails from GitHub: Invalid response", {
        emails,
        emailsRes,
        rawUserInfo,
      });
    }
    const { email, verified } = emails.find((e: any) => e.primary);

    return validateUserInfo({
      accountId: rawUserInfo.id?.toString(),
      displayName: rawUserInfo.name,
      profileImageUrl: rawUserInfo.avatar_url as any,
      email: email,
      emailVerified: verified,
    });
  }
}
