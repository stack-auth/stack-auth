import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { decodeJwt } from 'jose';
import { OAuthUserInfo, validateUserInfo } from "../utils";
import { OAuthBaseProvider, TokenSet } from "./base";

export class AppleProvider extends OAuthBaseProvider {
  private constructor(
    ...args: ConstructorParameters<typeof OAuthBaseProvider>
  ) {
    super(...args);
  }

  static async create(options: { clientId: string, clientSecret: string }) {
    return new AppleProvider(
      ...(await OAuthBaseProvider.createConstructorArgs({
        issuer: "https://appleid.apple.com",
        authorizationEndpoint: "https://appleid.apple.com/auth/authorize",
        tokenEndpoint: "https://appleid.apple.com/auth/token",
        redirectUri: getEnvVariable("NEXT_PUBLIC_STACK_API_URL") + "/api/v1/auth/oauth/callback/apple",
        jwksUri: "https://appleid.apple.com/auth/keys",
        baseScope: "name email",
        authorizationExtraParams: { "response_mode": "form_post" },
        tokenEndpointAuthMethod: "client_secret_post",
        openid: true,
        ...options,
      }))
    );
  }

  async postProcessUserInfo(tokenSet: TokenSet): Promise<OAuthUserInfo> {
    const idToken = tokenSet.idToken ?? throwErr("No id token received for Apple OAuth", { tokenSet });

    let payload;
    try {
      payload = decodeJwt(idToken);
    } catch (error) {
      throw new StackAssertionError("Error decoding Apple ID token", { error });
    }

    return validateUserInfo({
      accountId: payload.sub,
      email: payload.email,
      emailVerified: !!payload.email_verified,
    });
  }

  async checkAccessTokenValidity(accessToken: string): Promise<boolean> {
    const res = await fetch("https://appleid.apple.com/auth/userinfo", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return res.ok;
  }
}
