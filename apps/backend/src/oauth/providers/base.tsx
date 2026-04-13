import { KnownErrors } from "@stackframe/stack-shared";
import { StackAssertionError, StatusError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { mergeScopeStrings } from "@stackframe/stack-shared/dist/utils/strings";
import { CallbackParamsType, Client, Issuer, TokenSet as OIDCTokenSet, generators } from "openid-client";
import { OAuthUserInfo } from "../utils";

const OAUTH_USERINFO_TOTAL_ATTEMPTS = 3;
const OAUTH_USERINFO_RETRY_DELAY_BASE_MS = 250;
const RETRYABLE_OAUTH_NETWORK_ERROR_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);
const RETRYABLE_OAUTH_PROVIDER_ERROR_CODES = new Set([
  "server_error",
  "temporarily_unavailable",
  "timeout",
]);

export type TokenSet = {
  accessToken: string,
  refreshToken?: string,
  accessTokenExpiredAt: Date,
  idToken?: string,
};

function getStringProperty(obj: unknown, key: string): string | undefined {
  if (typeof obj !== "object" || obj === null || !(key in obj)) {
    return undefined;
  }
  const value = Reflect.get(obj, key);
  return typeof value === "string" ? value : undefined;
}

function getUnknownProperty(obj: unknown, key: string): unknown {
  if (typeof obj !== "object" || obj === null || !(key in obj)) {
    return undefined;
  }
  return Reflect.get(obj, key);
}

function getNumberProperty(obj: unknown, key: string): number | undefined {
  if (typeof obj !== "object" || obj === null || !(key in obj)) {
    return undefined;
  }
  const value = Reflect.get(obj, key);
  return typeof value === "number" ? value : undefined;
}

export function isRetryableOAuthUserInfoError(error: unknown): boolean {
  const code = getStringProperty(error, "code");
  if (code && RETRYABLE_OAUTH_NETWORK_ERROR_CODES.has(code)) {
    return true;
  }

  const providerErrorCode = getStringProperty(error, "error")?.toLowerCase();
  if (providerErrorCode && RETRYABLE_OAUTH_PROVIDER_ERROR_CODES.has(providerErrorCode)) {
    return true;
  }

  const name = getStringProperty(error, "name");
  if (name === "AbortError" || name === "TimeoutError") {
    return true;
  }

  const response = getUnknownProperty(error, "response");
  const responseStatus = getNumberProperty(response, "status");
  if (responseStatus === 429 || (responseStatus != null && responseStatus >= 500)) {
    return true;
  }

  const message = getStringProperty(error, "message")?.toLowerCase();
  if (message?.includes("outgoing request timed out")) {
    return true;
  }
  if (message?.includes("timed out")) {
    return true;
  }

  const cause = getUnknownProperty(error, "cause");
  if (cause !== undefined && cause !== error) {
    return isRetryableOAuthUserInfoError(cause);
  }

  return false;
}

function processTokenSet(providerName: string, tokenSet: OIDCTokenSet, defaultAccessTokenExpiresInMillis?: number): TokenSet {
  if (!tokenSet.access_token) {
    throw new StackAssertionError(`No access token received from ${providerName}.`, { tokenSet, providerName });
  }

  // if expires_in or expires_at provided, use that
  // otherwise, if defaultAccessTokenExpiresInMillis provided, use that
  // otherwise, use 1h, and log an error

  if (!tokenSet.expires_in && !tokenSet.expires_at && !defaultAccessTokenExpiresInMillis) {
    captureError("processTokenSet", new StackAssertionError(`No expires_in or expires_at received from OAuth provider ${providerName}. Falling back to 1h`, { tokenSetKeys: Object.keys(tokenSet) }));
  }

  return {
    idToken: tokenSet.id_token,
    accessToken: tokenSet.access_token,
    refreshToken: tokenSet.refresh_token,
    accessTokenExpiredAt: tokenSet.expires_in ?
      new Date(Date.now() + tokenSet.expires_in * 1000) :
      tokenSet.expires_at ? new Date(tokenSet.expires_at * 1000) :
        defaultAccessTokenExpiresInMillis ?
          new Date(Date.now() + defaultAccessTokenExpiresInMillis) :
          new Date(Date.now() + 3600 * 1000),
  };
}

export abstract class OAuthBaseProvider {
  constructor(
    public readonly oauthClient: Client,
    public readonly scope: string,
    public readonly redirectUri: string,
    public readonly authorizationExtraParams?: Record<string, string>,
    public readonly defaultAccessTokenExpiresInMillis?: number,
    public readonly noPKCE?: boolean,
    public readonly openid?: boolean,
    public readonly alternativeIssuers?: string[],
  ) {}

  protected static async createConstructorArgs(options:
    & {
      clientId: string,
      clientSecret: string,
      redirectUri: string,
      baseScope: string,
      authorizationExtraParams?: Record<string, string>,
      defaultAccessTokenExpiresInMillis?: number,
      tokenEndpointAuthMethod?: "client_secret_post" | "client_secret_basic",
      noPKCE?: boolean,
      alternativeIssuers?: string[],
    }
    & (
      | ({
        issuer: string,
        authorizationEndpoint: string,
        tokenEndpoint: string,
        userinfoEndpoint?: string,
      }
      & (
        | {
          openid: true,
          jwksUri: string,
        }
        | {
          openid?: false,
        }
      )
    )
      | {
        discoverFromUrl: string,
        openid?: boolean,
      }
    )
  ) {
    const issuer = "discoverFromUrl" in options ? await Issuer.discover(options.discoverFromUrl) : new Issuer({
      issuer: options.issuer,
      authorization_endpoint: options.authorizationEndpoint,
      token_endpoint: options.tokenEndpoint,
      userinfo_endpoint: options.userinfoEndpoint,
      jwks_uri: options.openid ? options.jwksUri : undefined,
    });
    const oauthClient = new issuer.Client({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      redirect_uri: options.redirectUri,
      response_types: ["code"],
      token_endpoint_auth_method: options.tokenEndpointAuthMethod ?? "client_secret_basic",
    });

    return [
      oauthClient,
      options.baseScope,
      options.redirectUri,
      options.authorizationExtraParams,
      options.defaultAccessTokenExpiresInMillis,
      options.noPKCE,
      options.openid,
      options.alternativeIssuers,
    ] as const;
  }

  getAuthorizationUrl(options: {
    codeVerifier: string,
    state: string,
    extraScope?: string,
  }) {
    return this.oauthClient.authorizationUrl({
      scope: mergeScopeStrings(this.scope, options.extraScope || ""),
      ...(this.noPKCE ? {} : {
        code_challenge_method: "S256",
        code_challenge: generators.codeChallenge(options.codeVerifier),
      }),
      state: options.state,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      ...this.authorizationExtraParams,
    });
  }

  async getCallback(options: {
    callbackParams: CallbackParamsType,
    codeVerifier: string,
    state: string,
  }): Promise<{ userInfo: OAuthUserInfo, tokenSet: TokenSet }> {
    let tokenSet;
    const callbackParams = { ...options.callbackParams };

    // If the authorization server returns an `iss` parameter (RFC 9207) that matches
    // one of the known alternative issuers, rewrite it to the configured issuer so
    // openid-client's validation accepts it.
    if (
      this.alternativeIssuers
      && typeof callbackParams.iss === "string"
      && this.alternativeIssuers.includes(callbackParams.iss)
    ) {
      callbackParams.iss = this.oauthClient.issuer.metadata.issuer;
    }

    const params = [
      this.redirectUri,
      callbackParams,
      {
        code_verifier: this.noPKCE ? undefined : options.codeVerifier,
        state: options.state,
      },
    ] as const;

    try {
      if (this.openid) {
        tokenSet = await this.oauthClient.callback(...params);
      } else {
        tokenSet = await this.oauthClient.oauthCallback(...params);
      }
    } catch (error: any) {
      if (error?.error === "invalid_grant" || error?.error?.error === "invalid_grant") {
        // while this is technically a "user" error, it would only be caused by a client that is not properly implemented
        // to catch the case where our own client is not properly implemented, we capture the error here
        // TODO is the comment above actually true? This is inner OAuth, not outer OAuth, so why does the client implementation matter?
        // Though a reasonable scenario where this might happen is eg. if the authorization code expires before we can exchange it, or the page is reloaded so we try to reuse a code that was already used
        captureError("inner-oauth-callback", { error, params });
        throw new StatusError(400, "Inner OAuth callback failed due to invalid grant. Please try again.");
      }
      if (error?.error === 'access_denied' || error?.error === 'consent_required') {
        throw new KnownErrors.OAuthProviderAccessDenied();
      }
      if (error?.error === 'invalid_client') {
        throw new StatusError(400, `Invalid client credentials for this OAuth provider. Please ensure the configuration in the Stack Auth dashboard is correct.`);
      }
      if (isRetryableOAuthUserInfoError(error)) {
        captureError("inner-oauth-callback-retryable-error", new StackAssertionError("Transient OAuth provider failure during callback exchange.", {
          provider: this.constructor.name,
          params,
          cause: error,
        }));
        throw new KnownErrors.OAuthProviderTemporarilyUnavailable();
      }
      if (error?.error === 'unauthorized_scope_error') {
        const scopeMatch = error?.error_description?.match(/Scope &quot;([^&]+)&quot; is not authorized for your application/);
        const missingScope = scopeMatch ? scopeMatch[1] : null;
        throw new StatusError(400, `The OAuth provider does not allow the requested scope${missingScope ? ` "${missingScope}"` : ""}. Please ensure the scope is configured correctly in the provider's dashboard.`);
      }
      throw new StackAssertionError(`Inner OAuth callback failed due to error: ${error}`, { params, cause: error });
    }

    if ('error' in tokenSet) {
      throw new StackAssertionError(`Inner OAuth callback failed due to error: ${tokenSet.error}, ${tokenSet.error_description}`, { params, tokenSet });
    }
    tokenSet = processTokenSet(this.constructor.name, tokenSet, this.defaultAccessTokenExpiresInMillis);

    const userInfoResult = await Result.retry(async () => {
      try {
        return Result.ok(await this.postProcessUserInfo(tokenSet));
      } catch (error) {
        if (isRetryableOAuthUserInfoError(error)) {
          return Result.error(error);
        }
        throw error;
      }
    }, OAUTH_USERINFO_TOTAL_ATTEMPTS, {
      exponentialDelayBase: OAUTH_USERINFO_RETRY_DELAY_BASE_MS,
    });

    if (userInfoResult.status === "error") {
      captureError("oauth-userinfo-retry-exhausted", new StackAssertionError("Failed to fetch OAuth user info after retries.", {
        attempts: userInfoResult.attempts,
        provider: this.constructor.name,
        cause: userInfoResult.error,
      }));
      throw new KnownErrors.OAuthProviderTemporarilyUnavailable();
    }

    return {
      userInfo: userInfoResult.data,
      tokenSet,
    };
  }

  /**
   * Refreshes the access token using a refresh token.
   *
   * Returns a Result to differentiate between:
   * - Success: the token was refreshed successfully
   * - Handled error: the refresh token is invalid/expired (user needs to re-authenticate)
   * - Thrown error: unexpected failures that may indicate bugs or configuration issues
   */
  async getAccessToken(options: {
    refreshToken: string,
    scope?: string,
  }): Promise<Result<TokenSet, string>> {
    let tokenSet;
    try {
      tokenSet = await this.oauthClient.refresh(options.refreshToken, { exchangeBody: { scope: options.scope } });
    } catch (error: any) {
      // Handle known OAuth error cases where the refresh token is no longer valid
      // These are expected scenarios that don't indicate bugs
      if (error?.error === "invalid_grant" || error?.error?.error === "invalid_grant") {
        return Result.error("Refresh token is invalid or expired");
      }
      if (error?.error === "access_denied" || error?.error === "consent_required") {
        return Result.error("Access was denied or consent was revoked");
      }
      if (error?.error === "invalid_token") {
        return Result.error("Refresh token is invalid");
      }
      if (error?.error === "unauthorized_client") {
        return Result.error("OAuth Client ID is no longer authorized to use this refresh token");
      }

      // For unknown errors, throw so they can be investigated
      throw new StackAssertionError(`Failed to refresh access token: ${error}`, { cause: error });
    }

    return Result.ok(processTokenSet(this.constructor.name, tokenSet, this.defaultAccessTokenExpiresInMillis));
  }

  // If the token can be revoked before it expires, override this method to make an API call to the provider to check if the token is valid
  abstract checkAccessTokenValidity(accessToken: string): Promise<boolean>;

  abstract postProcessUserInfo(tokenSet: TokenSet): Promise<OAuthUserInfo>;
}
