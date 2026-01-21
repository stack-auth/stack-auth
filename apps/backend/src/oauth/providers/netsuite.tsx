import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { OAuthUserInfo, validateUserInfo } from "../utils";
import { OAuthBaseProvider, TokenSet } from "./base";

export class NetSuiteProvider extends OAuthBaseProvider {
  private accountId: string;

  private constructor(
    accountId: string,
    ...args: ConstructorParameters<typeof OAuthBaseProvider>
  ) {
    super(...args);
    this.accountId = accountId;
  }

  static async create(options: {
    clientId: string,
    clientSecret: string,
    netsuiteAccountId?: string,
  }) {
    const accountId = options.netsuiteAccountId || getEnvVariable("STACK_NETSUITE_ACCOUNT_ID", "");
    if (!accountId) {
      throw new StackAssertionError("NetSuite Account ID is required. Set STACK_NETSUITE_ACCOUNT_ID environment variable or provide accountId in options.");
    }

    return new NetSuiteProvider(
      accountId,
      ...await OAuthBaseProvider.createConstructorArgs({
        issuer: `https://system.netsuite.com`,
        authorizationEndpoint: `https://${accountId}.app.netsuite.com/app/login/oauth2/authorize.nl`,
        tokenEndpoint: `https://${accountId}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`,
        redirectUri: getEnvVariable("NEXT_PUBLIC_STACK_API_URL") + "/api/v1/auth/oauth/callback/netsuite",
        baseScope: "rest_webservices",
        tokenEndpointAuthMethod: "client_secret_basic",
        // NetSuite access tokens typically expire in 1 hour
        defaultAccessTokenExpiresInMillis: 1000 * 60 * 60, // 1 hour
        ...options,
      })
    );
  }

  async postProcessUserInfo(tokenSet: TokenSet): Promise<OAuthUserInfo> {
    // First, get the current user's employee record ID
    const currentUserRes = await fetch(`https://${this.accountId}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/userinfo`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenSet.accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
    });

    if (!currentUserRes.ok) {
      // If employee endpoint fails, try to get basic user info from a different approach
      // NetSuite doesn't have a standard userinfo endpoint, so we'll use what we can get
      throw new StackAssertionError(`Error fetching user info from NetSuite: Status code ${currentUserRes.status}`, {
        currentUserRes,
        hasAccessToken: !!tokenSet.accessToken,
        hasRefreshToken: !!tokenSet.refreshToken,
        accessTokenExpiredAt: tokenSet.accessTokenExpiredAt,
      });
    }

    const userData = await currentUserRes.json();

    // NetSuite employee records structure can vary, but typically include:
    // - id: internal ID
    // - entityId: employee ID
    // - firstName, lastName: name components
    // - email: email address
    let accountId: string;
    let displayName: string | null = null;
    let email: string | null = null;
    let emailVerified = false;

    if (userData.items && userData.items.length > 0) {
      // If we get a list of employees, take the first one (current user)
      const employee = userData.items[0];
      accountId = employee.id?.toString() || employee.entityId?.toString() || "";
      if (!accountId) {
        throw new StackAssertionError("No valid ID found in NetSuite employee record", { employee });
      }
      displayName = [employee.firstName, employee.lastName].filter(Boolean).join(" ") || employee.entityId;
      email = employee.email;
      emailVerified = !!employee.email; // Assume verified if present
    } else if (userData.id) {
      // If we get a single employee record
      accountId = userData.id.toString();
      displayName = [userData.firstName, userData.lastName].filter(Boolean).join(" ") || userData.entityId;
      email = userData.email;
      emailVerified = !!userData.email;
    } else {
      throw new StackAssertionError("Unable to extract user information from NetSuite response", {
        userData,
      });
    }

    if (!accountId) {
      throw new StackAssertionError("No account ID found in NetSuite user data", {
        userData,
      });
    }

    return validateUserInfo({
      accountId,
      displayName,
      email,
      profileImageUrl: null, // NetSuite typically doesn't provide profile images via API
      emailVerified,
    });
  }

  async checkAccessTokenValidity(accessToken: string): Promise<boolean> {
    try {
      const res = await fetch(`https://${this.accountId}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/userinfo`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });
      return res.ok;
    } catch (error) {
      return false;
    }
  }
}
