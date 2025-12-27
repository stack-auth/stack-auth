import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { getJwtInfo } from "@stackframe/stack-shared/dist/utils/jwt";
import { OAuthUserInfo, validateUserInfo } from "../utils";
import { OAuthBaseProvider, TokenSet } from "./base";


export class OktaProvider extends OAuthBaseProvider {
  private oktaDomain : string;
  private constructor(
    oktaDomain: string,
    ...args: ConstructorParameters<typeof OAuthBaseProvider>
  ) {
    super(...args);
    this.oktaDomain = oktaDomain
  }

  static async create(options: {
    clientId: string;
    clientSecret: string;
    oktaDomain: string;
  }) {
    const  oktaDomain  = options.oktaDomain;

    if(!oktaDomain) throw new StackAssertionError("Okta domain is required ")

    return new OktaProvider(
      oktaDomain,
      ...await OAuthBaseProvider.createConstructorArgs({
        issuer: `https://${oktaDomain}`,
        authorizationEndpoint: `https://${oktaDomain}/v1/authorize`,
        tokenEndpoint: `https://${oktaDomain}/v1/token`,
        redirectUri: getEnvVariable("OAUTH_REDIRECT_URI")!,
        jwksUri: `https://${oktaDomain}/v1/keys`,
        baseScope: "openid email profile",
        authorizationExtraParams: { response_mode: "form_post" },
        tokenEndpointAuthMethod: "client_secret_basic",
        ...options,
      }))
    ;
  }

  async postProcessUserInfo(tokenSet: TokenSet): Promise<OAuthUserInfo> {
    const rawUserInfoRes = await fetch(`https://${this.oktaDomain}/v1/userinfo`,{ 
      headers: {
        Authorization: `Bearer ${tokenSet.accessToken}`,
      },
    });

    if (!rawUserInfoRes.ok) {
      throw new StackAssertionError(
        "Error fetching user information from Okta",
        {
          status: rawUserInfoRes.status,
          body: await rawUserInfoRes.text(),
          jwtInfo: await getJwtInfo({ jwt: tokenSet.accessToken }),
        }
      );
    }

    const rawUserInfo = await rawUserInfoRes.json();

    return validateUserInfo({
      accountId: rawUserInfo.sub,
      displayName: rawUserInfo.name,
      profileImageUrl: rawUserInfo.picture,
      email: rawUserInfo.email,
      emailVerified: rawUserInfo.email_verified,
    });
  }
  async checkAccessTokenValidity(accessToken: string): Promise<boolean> {
    const res = await fetch(`https://${this.oktaDomain}/v1/userinfo`,{
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return res.ok;
  }
}
