import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { OAuthUserInfo, validateUserInfo } from "../utils";
import { OAuthBaseProvider, TokenSet } from "./base";

export class TwitchProvider extends OAuthBaseProvider {
  private constructor(
    ...args: ConstructorParameters<typeof OAuthBaseProvider>
  ) {
    super(...args);
  }

  static async create(options: {
    clientId: string,
    clientSecret: string,
  }) {
    return new TwitchProvider(...await OAuthBaseProvider.createConstructorArgs({
      issuer: "https://id.twitch.tv",
      authorizationEndpoint: "https://id.twitch.tv/oauth2/authorize",
      tokenEndpoint: "https://id.twitch.tv/oauth2/token",
      tokenEndpointAuthMethod: "client_secret_post",
      redirectUri: getEnvVariable("NEXT_PUBLIC_STACK_API_URL") + "/api/v1/auth/oauth/callback/twitch",
      baseScope: "user:read:email",
      ...options,
    }));
  }

  async postProcessUserInfo(tokenSet: TokenSet): Promise<OAuthUserInfo> {
    const info = await fetch("https://api.twitch.tv/helix/users", {
      headers: {
        Authorization: `Bearer ${tokenSet.accessToken}`,
        "Client-Id": this.oauthClient.client_id as string,
      },
    }).then((res) => res.json());


    const userInfo = info.data?.[0];

    return validateUserInfo({
      accountId: userInfo.id,
      displayName: userInfo.display_name,
      email: userInfo.email,
      profileImageUrl: userInfo.profile_image_url,
      emailVerified: true,
    });
  }

  async checkAccessTokenValidity(accessToken: string): Promise<boolean> {
    const info = await fetch("https://api.twitch.tv/helix/users", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": this.oauthClient.client_id as string,
      },
    }).then((res) => res.json());
    return info.data?.[0] !== undefined;
  }
}
