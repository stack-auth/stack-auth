import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { OAuthUserInfo, validateUserInfo } from "../utils";
import { OAuthBaseProvider, TokenSet } from "./base";

export class FacebookProvider extends OAuthBaseProvider {
  private constructor(
    ...args: ConstructorParameters<typeof OAuthBaseProvider>
  ) {
    super(...args);
  }

  static async create(options: {
    clientId: string,
    clientSecret: string,
    facebookConfigId?: string,
  }) {
    return new FacebookProvider(...await OAuthBaseProvider.createConstructorArgs({
      issuer: "https://www.facebook.com",
      authorizationEndpoint: "https://facebook.com/v20.0/dialog/oauth/",
      tokenEndpoint: "https://graph.facebook.com/v20.0/oauth/access_token",
      redirectUri: getEnvVariable("NEXT_PUBLIC_STACK_API_URL") + "/api/v1/auth/oauth/callback/facebook",
      baseScope: "openid public_profile email",
      openid: true,
      jwksUri: "https://www.facebook.com/.well-known/oauth/openid/jwks",
      authorizationExtraParams: options.facebookConfigId ? {
        config_id: options.facebookConfigId,
      } : undefined,
      ...options,
    }));
  }

  async postProcessUserInfo(tokenSet: TokenSet): Promise<OAuthUserInfo> {
    const url = new URL('https://graph.facebook.com/v3.2/me');
    url.searchParams.append('access_token', tokenSet.accessToken || "");
    url.searchParams.append('fields', 'id,name,email');
    const rawUserInfo = await fetch(url).then((res) => res.json());
    if (!rawUserInfo.email) {
      throw new StatusError(StatusError.BadRequest, `Facebook OAuth did not return an email address. This is likely because "email" scope is not selected on the Facebook developer dashboard.`);
    }

    const profileImageUrl = new URL(`https://graph.facebook.com/${rawUserInfo.id}`);
    profileImageUrl.searchParams.append("access_token", tokenSet.accessToken || "");
    profileImageUrl.searchParams.append("fields", "picture.type(small)");
    const profileImage = await fetch(profileImageUrl).then((res) => res.json());

    return validateUserInfo({
      accountId: rawUserInfo.id,
      displayName: rawUserInfo.name,
      email: rawUserInfo.email,
      profileImageUrl: profileImage?.picture?.data?.url,
      // Even though it seems like that Facebook verifies the email address with the API calls, but the official docs say that it's not verified.
      // To be on the safe side, we'll assume that it's not verified.
      // https://stackoverflow.com/questions/14280535/is-it-possible-to-check-if-an-email-is-confirmed-on-facebook
      // https://developers.facebook.com/docs/facebook-login/guides/advanced/existing-system#associating2
      emailVerified: false,
    });
  }

  async checkAccessTokenValidity(accessToken: string): Promise<boolean> {
    const res = await fetch("https://graph.facebook.com/v3.2/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return res.ok;
  }
}
