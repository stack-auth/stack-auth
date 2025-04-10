import * as oauth from 'oauth4webapi';

import * as yup from 'yup';
import { KnownError, KnownErrors } from '../known-errors';
import { AccessToken, InternalSession, RefreshToken } from '../sessions';
import { generateSecureRandomString } from '../utils/crypto';
import { StackAssertionError, throwErr } from '../utils/errors';
import { globalVar } from '../utils/globals';
import { HTTP_METHODS, HttpMethod } from '../utils/http';
import { ReadonlyJson } from '../utils/json';
import { filterUndefined, filterUndefinedOrNull } from '../utils/objects';
import { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from '../utils/passkey';
import { wait } from '../utils/promises';
import { Result } from "../utils/results";
import { deindent } from '../utils/strings';
import { ContactChannelsCrud } from './crud/contact-channels';
import { CurrentUserCrud } from './crud/current-user';
import { ConnectedAccountAccessTokenCrud } from './crud/oauth';
import { TeamApiKeysCrud, UserApiKeysCrud, teamApiKeysCreateInputSchema, teamApiKeysCreateOutputSchema, userApiKeysCreateInputSchema, userApiKeysCreateOutputSchema } from './crud/project-api-keys';
import { ProjectPermissionsCrud } from './crud/project-permissions';
import { InternalProjectsCrud, ProjectsCrud } from './crud/projects';
import { SessionsCrud } from './crud/sessions';
import { TeamInvitationCrud } from './crud/team-invitation';
import { TeamMemberProfilesCrud } from './crud/team-member-profiles';
import { TeamPermissionsCrud } from './crud/team-permissions';
import { TeamsCrud } from './crud/teams';

export type ClientInterfaceOptions = {
  clientVersion: string,
  // This is a function instead of a string because it might be different based on the environment (for example client vs server)
  getBaseUrl: () => string,
  extraRequestHeaders: Record<string, string>,
  projectId: string,
  prepareRequest?: () => Promise<void>,
} & ({
  publishableClientKey: string,
} | {
  projectOwnerSession: InternalSession,
});

export class StackClientInterface {
  constructor(public readonly options: ClientInterfaceOptions) {
    // nothing here
  }

  get projectId() {
    return this.options.projectId;
  }

  getApiUrl() {
    return this.options.getBaseUrl() + "/api/v1";
  }

  public async runNetworkDiagnostics(session?: InternalSession | null, requestType?: "client" | "server" | "admin") {
    const tryRequest = async (cb: () => Promise<void>) => {
      try {
        await cb();
        return "OK";
      } catch (e) {
        return `${e}`;
      }
    };
    const cfTrace = await tryRequest(async () => {
      const res = await fetch("https://1.1.1.1/cdn-cgi/trace");
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
      }
    });
    const apiRoot = session !== undefined && requestType !== undefined ? await tryRequest(async () => {
      const res = await this.sendClientRequestInner("/", {}, session!, requestType);
      if (res.status === "error") {
        throw res.error;
      }
    }) : "Not tested";
    const baseUrlBackend = await tryRequest(async () => {
      const res = await fetch(new URL("/health", this.getApiUrl()));
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
      }
    });
    const prodDashboard = await tryRequest(async () => {
      const res = await fetch("https://app.stack-auth.com/health");
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
      }
    });
    const prodBackend = await tryRequest(async () => {
      const res = await fetch("https://api.stack-auth.com/health");
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
      }
    });
    return {
      "navigator?.onLine": globalVar.navigator?.onLine,
      cfTrace,
      apiRoot,
      baseUrlBackend,
      prodDashboard,
      prodBackend,
    };
  }

  protected async _createNetworkError(cause: Error, session?: InternalSession | null, requestType?: "client" | "server" | "admin") {
    return new Error(deindent`
      Stack Auth is unable to connect to the server. Please check your internet connection and try again.
      
      If the problem persists, please contact support and provide a screenshot of your entire browser console.

      ${cause}
      
      ${JSON.stringify(await this.runNetworkDiagnostics(session, requestType), null, 2)}
    `, { cause: cause });
  }

  protected async _networkRetry<T>(cb: () => Promise<Result<T, any>>, session?: InternalSession | null, requestType?: "client" | "server" | "admin"): Promise<T> {
    const retriedResult = await Result.retry(
      cb,
      5,
      { exponentialDelayBase: 1000 },
    );

    // try to diagnose the error for the user
    if (retriedResult.status === "error") {
      if (globalVar.navigator && !globalVar.navigator.onLine) {
        throw new Error("Failed to send Stack network request. It seems like you are offline, please check your internet connection and try again. This is not an error with Stack Auth. (window.navigator.onLine is falsy)", { cause: retriedResult.error });
      }
      throw await this._createNetworkError(retriedResult.error, session, requestType);
    }
    return retriedResult.data;
  }

  protected async _networkRetryException<T>(cb: () => Promise<T>, session?: InternalSession | null, requestType?: "client" | "server" | "admin"): Promise<T> {
    return await this._networkRetry(async () => await Result.fromThrowingAsync(cb), session, requestType);
  }

  public async fetchNewAccessToken(refreshToken: RefreshToken) {
    if (!('publishableClientKey' in this.options)) {
      // TODO support it
      throw new Error("Admin session token is currently not supported for fetching new access token. Did you try to log in on a StackApp initiated with the admin session?");
    }

    const as = {
      issuer: this.options.getBaseUrl(),
      algorithm: 'oauth2',
      token_endpoint: this.getApiUrl() + '/auth/oauth/token',
    };
    const client: oauth.Client = {
      client_id: this.projectId,
      client_secret: this.options.publishableClientKey,
      token_endpoint_auth_method: 'client_secret_post',
    };

    const rawResponse = await this._networkRetryException(
      async () => await oauth.refreshTokenGrantRequest(
        as,
        client,
        refreshToken.token,
      )
    );
    const response = await this._processResponse(rawResponse);

    if (response.status === "error") {
      const error = response.error;
      if (error instanceof KnownErrors.RefreshTokenError) {
        return null;
      }
      throw error;
    }

    if (!response.data.ok) {
      const body = await response.data.text();
      throw new Error(`Failed to send refresh token request: ${response.status} ${body}`);
    }

    const result = await oauth.processRefreshTokenResponse(as, client, response.data);
    if (oauth.isOAuth2Error(result)) {
      // TODO Handle OAuth 2.0 response body error
      throw new StackAssertionError("OAuth error", { result });
    }

    if (!result.access_token) {
      throw new StackAssertionError("Access token not found in token endpoint response, this is weird!");
    }

    return new AccessToken(result.access_token);
  }

  public async sendClientRequest(
    path: string,
    requestOptions: RequestInit,
    session: InternalSession | null,
    requestType: "client" | "server" | "admin" = "client",
  ) {
    session ??= this.createSession({
      refreshToken: null,
    });


    return await this._networkRetry(
      () => this.sendClientRequestInner(path, requestOptions, session!, requestType),
      session,
      requestType,
    );
  }

  public createSession(options: Omit<ConstructorParameters<typeof InternalSession>[0], "refreshAccessTokenCallback">): InternalSession {
    const session = new InternalSession({
      refreshAccessTokenCallback: async (refreshToken) => await this.fetchNewAccessToken(refreshToken),
      ...options,
    });
    return session;
  }

  protected async sendClientRequestAndCatchKnownError<E extends typeof KnownErrors[keyof KnownErrors]>(
    path: string,
    requestOptions: RequestInit,
    tokenStoreOrNull: InternalSession | null,
    errorsToCatch: readonly E[],
  ): Promise<Result<
    Response & {
      usedTokens: {
        accessToken: AccessToken,
        refreshToken: RefreshToken | null,
      } | null,
    },
    InstanceType<E>
  >> {
    try {
      return Result.ok(await this.sendClientRequest(path, requestOptions, tokenStoreOrNull));
    } catch (e) {
      for (const errorType of errorsToCatch) {
        if (e instanceof errorType) {
          return Result.error(e as InstanceType<E>);
        }
      }
      throw e;
    }
  }

  private async sendClientRequestInner(
    path: string,
    options: RequestInit,
    session: InternalSession,
    requestType: "client" | "server" | "admin",
  ): Promise<Result<Response & {
    usedTokens: {
      accessToken: AccessToken,
      refreshToken: RefreshToken | null,
    } | null,
  }>> {
    /**
     * `tokenObj === null` means the session is invalid/not logged in
     */
    let tokenObj = await session.getOrFetchLikelyValidTokens(20_000);

    let adminSession = "projectOwnerSession" in this.options ? this.options.projectOwnerSession : null;
    let adminTokenObj = adminSession ? await adminSession.getOrFetchLikelyValidTokens(20_000) : null;

    // all requests should be dynamic to prevent Next.js caching
    await this.options.prepareRequest?.();

    let url = this.getApiUrl() + path;
    if (url.endsWith("/")) {
      url = url.slice(0, -1);
    }
    const params: RequestInit = {
      /**
       * This fetch may be cross-origin, in which case we don't want to send cookies of the
       * original origin (this is the default behavior of `credentials`).
       *
       * To help debugging, also omit cookies on same-origin, so we don't accidentally
       * implement reliance on cookies anywhere.
       *
       * However, Cloudflare Workers don't actually support `credentials`, so we only set it
       * if Cloudflare-exclusive globals are not detected. https://github.com/cloudflare/workers-sdk/issues/2514
       */
      ...("WebSocketPair" in globalVar ? {} : {
        credentials: "omit",
      }),
      ...options,
      headers: {
        "X-Stack-Override-Error-Status": "true",
        "X-Stack-Project-Id": this.projectId,
        "X-Stack-Access-Type": requestType,
        "X-Stack-Client-Version": this.options.clientVersion,
        ...(tokenObj ? {
          "X-Stack-Access-Token": tokenObj.accessToken.token,
        } : {}),
        ...(tokenObj?.refreshToken ? {
          "X-Stack-Refresh-Token": tokenObj.refreshToken.token,
        } : {}),
        ...('publishableClientKey' in this.options ? {
          "X-Stack-Publishable-Client-Key": this.options.publishableClientKey,
        } : {}),
        ...(adminTokenObj ? {
          "X-Stack-Admin-Access-Token": adminTokenObj.accessToken.token,
        } : {}),
        /**
         * Next.js until v15 would cache fetch requests by default, and forcefully disabling it was nearly impossible.
         *
         * This header is used to change the cache key and hence always disable it, because we do our own caching.
         *
         * When we drop support for Next.js <15, we may be able to remove this header, but please make sure that this is
         * the case (I haven't actually tested.)
         */
        "X-Stack-Random-Nonce": generateSecureRandomString(),
        ...this.options.extraRequestHeaders,
        ...options.headers,
      },
      /**
       * Cloudflare Workers does not support cache, so don't pass it there
       */
      ...("WebSocketPair" in globalVar ? {} : {
        cache: "no-store",
      }),
    };

    let rawRes;
    try {
      rawRes = await fetch(url, params);
    } catch (e) {
      if (e instanceof TypeError) {
        // Likely to be a network error. Retry if the request is idempotent, throw network error otherwise.
        if (HTTP_METHODS[(params.method ?? "GET") as HttpMethod].idempotent) {
          return Result.error(e);
        } else {
          throw await this._createNetworkError(e, session, requestType);
        }
      }
      throw e;
    }

    const processedRes = await this._processResponse(rawRes);
    if (processedRes.status === "error") {
      // If the access token is invalid, reset it and retry
      if (processedRes.error instanceof KnownErrors.InvalidAccessToken) {
        if (!tokenObj) {
          throw new StackAssertionError("Received invalid access token, but session is not logged in", { tokenObj, processedRes });
        }
        session.markAccessTokenExpired(tokenObj.accessToken);
        return Result.error(processedRes.error);
      }

      // Same for the admin access token
      // TODO HACK: Some of the backend hasn't been ported to use the new error codes, so if we have project owner tokens we need to check for ApiKeyNotFound too. Once the migration to smartRouteHandlers is complete, we can check for InvalidAdminAccessToken only.
      if (adminSession && (processedRes.error instanceof KnownErrors.InvalidAdminAccessToken || processedRes.error instanceof KnownErrors.ApiKeyNotFound)) {
        if (!adminTokenObj) {
          throw new StackAssertionError("Received invalid admin access token, but admin session is not logged in", { adminTokenObj, processedRes });
        }
        adminSession.markAccessTokenExpired(adminTokenObj.accessToken);
        return Result.error(processedRes.error);
      }

      // Known errors are client side errors, so except for the ones above they should not be retried
      // Hence, throw instead of returning an error
      throw processedRes.error;
    }


    const res = Object.assign(processedRes.data, {
      usedTokens: tokenObj,
    });
    if (res.ok) {
      return Result.ok(res);
    } else if (res.status === 429) {
      // Rate limited, so retry if we can
      const retryAfter = res.headers.get("Retry-After");
      if (retryAfter !== null) {
        console.log(`Rate limited while sending request to ${url}. Will retry after ${retryAfter} seconds...`);
        await wait(Number(retryAfter) * 1000);
        return Result.error(new Error(`Rate limited, retrying after ${retryAfter} seconds`));
      }
      console.log(`Rate limited while sending request to ${url}, no retry-after header received. Retrying...`);
      return Result.error(new Error("Rate limited, no retry-after header received"));
    } else {
      const error = await res.text();

      const errorObj = new StackAssertionError(`Failed to send request to ${url}: ${res.status} ${error}`, { request: params, res, path });

      if (res.status === 508 && error.includes("INFINITE_LOOP_DETECTED")) {
        // Some Vercel deployments seem to have an odd infinite loop bug. In that case, retry.
        // See: https://github.com/stack-auth/stack-auth/issues/319
        return Result.error(errorObj);
      }

      // Do not retry, throw error instead of returning one
      throw errorObj;
    }
  }

  private async _processResponse(rawRes: Response): Promise<Result<Response, KnownError>> {
    let res = rawRes;
    if (rawRes.headers.has("x-stack-actual-status")) {
      const actualStatus = Number(rawRes.headers.get("x-stack-actual-status"));
      res = new Response(rawRes.body, {
        status: actualStatus,
        statusText: rawRes.statusText,
        headers: rawRes.headers,
      });
    }

    // Handle known errors
    if (res.headers.has("x-stack-known-error")) {
      const errorJson = await res.json();
      if (res.headers.get("x-stack-known-error") !== errorJson.code) {
        throw new StackAssertionError("Mismatch between x-stack-known-error header and error code in body; the server's response is invalid");
      }
      const error = KnownError.fromJson(errorJson);
      return Result.error(error);
    }

    return Result.ok(res);
  }

  public async checkFeatureSupport(options: { featureName?: string } & ReadonlyJson): Promise<never> {
    const res = await this.sendClientRequest("/check-feature-support", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options),
    }, null);

    throw new StackAssertionError(await res.text());
  }

  async sendForgotPasswordEmail(
    email: string,
    callbackUrl: string,
  ): Promise<Result<undefined, KnownErrors["UserNotFound"]>> {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/password/send-reset-code",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          callback_url: callbackUrl,
        }),
      },
      null,
      [KnownErrors.UserNotFound],
    );

    if (res.status === "error") {
      return Result.error(res.error);
    } else {
      return Result.ok(undefined);
    }
  }

  async sendVerificationEmail(
    email: string,
    callbackUrl: string,
    session: InternalSession
  ): Promise<KnownErrors["EmailAlreadyVerified"] | undefined> {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/contact-channels/send-verification-code",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          callback_url: callbackUrl,
        }),
      },
      session,
      [KnownErrors.EmailAlreadyVerified]
    );

    if (res.status === "error") {
      return res.error;
    }
  }

  async sendMagicLinkEmail(
    email: string,
    callbackUrl: string,
  ): Promise<Result<{ nonce: string }, KnownErrors["RedirectUrlNotWhitelisted"]>> {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/otp/send-sign-in-code",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          callback_url: callbackUrl,
        }),
      },
      null,
      [KnownErrors.RedirectUrlNotWhitelisted]
    );

    if (res.status === "error") {
      return Result.error(res.error);
    } else {
      return Result.ok(await res.data.json());
    }
  }

  async resetPassword(
    options: { code: string } & ({ password: string } | { onlyVerifyCode: true })
  ): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>> {
    const res = await this.sendClientRequestAndCatchKnownError(
      "onlyVerifyCode" in options ? "/auth/password/reset/check-code" : "/auth/password/reset",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          code: options.code,
          ...("password" in options ? { password: options.password } : {}),
        }),
      },
      null,
      [KnownErrors.VerificationCodeError]
    );

    if (res.status === "error") {
      return Result.error(res.error);
    } else {
      return Result.ok(undefined);
    }
  }

  async updatePassword(
    options: { oldPassword: string, newPassword: string },
    session: InternalSession
  ): Promise<KnownErrors["PasswordConfirmationMismatch"] | KnownErrors["PasswordRequirementsNotMet"] | undefined> {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/password/update",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          old_password: options.oldPassword,
          new_password: options.newPassword,
        }),
      },
      session,
      [KnownErrors.PasswordConfirmationMismatch, KnownErrors.PasswordRequirementsNotMet]
    );

    if (res.status === "error") {
      return res.error;
    }
  }

  async setPassword(
    options: { password: string },
    session: InternalSession
  ): Promise<KnownErrors["PasswordRequirementsNotMet"] | undefined> {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/password/set",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(options),
      },
      session,
      [KnownErrors.PasswordRequirementsNotMet]
    );

    if (res.status === "error") {
      return res.error;
    }
  }

  async verifyPasswordResetCode(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>> {
    const res = await this.resetPassword({ code, onlyVerifyCode: true });
    if (res.status === "error") {
      return Result.error(res.error);
    } else {
      return Result.ok(undefined);
    }
  }

  async verifyEmail(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>> {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/contact-channels/verify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          code,
        }),
      },
      null,
      [KnownErrors.VerificationCodeError]
    );

    if (res.status === "error") {
      return Result.error(res.error);
    } else {
      return Result.ok(undefined);
    }
  }

  async initiatePasskeyRegistration(
    options: {},
    session: InternalSession
  ): Promise<Result<{ options_json: PublicKeyCredentialCreationOptionsJSON, code: string }, KnownErrors[]>> {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/passkey/initiate-passkey-registration",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(options),
      },
      session,
      []
    );

    if (res.status === "error") {
      return Result.error(res.error);
    }

    return Result.ok(await res.data.json());
  }

  async registerPasskey(
    options: { credential: RegistrationResponseJSON, code: string },
    session: InternalSession
  ): Promise<Result<undefined, KnownErrors["PasskeyRegistrationFailed"]>> {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/passkey/register",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(options),
      },
      session,
      [KnownErrors.PasskeyRegistrationFailed]
    );
    if (res.status === "error") {
      return Result.error(res.error);
    }
    return Result.ok(undefined);
  }

  async initiatePasskeyAuthentication(
    options: {
    },
    session: InternalSession
  ): Promise<Result<{ options_json: PublicKeyCredentialRequestOptionsJSON, code: string }, KnownErrors[]>> {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/passkey/initiate-passkey-authentication",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(options),
      },
      session,
      []
    );

    if (res.status === "error") {
      return Result.error(res.error);
    }

    return Result.ok(await res.data.json());
  }

  async sendTeamInvitation(options: {
    email: string,
    teamId: string,
    callbackUrl: string,
    session: InternalSession,
  }): Promise<void> {
    await this.sendClientRequest(
      "/team-invitations/send-code",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: options.email,
          team_id: options.teamId,
          callback_url: options.callbackUrl,
        }),
      },
      options.session,
    );
  }

  async acceptTeamInvitation<T extends 'use' | 'details' | 'check'>(options: {
    code: string,
    session: InternalSession,
    type: T,
  }): Promise<Result<T extends 'details' ? { team_display_name: string } : undefined, KnownErrors["VerificationCodeError"]>> {
    const res = await this.sendClientRequestAndCatchKnownError(
      options.type === 'check' ?
        "/team-invitations/accept/check-code" :
        options.type === 'details' ?
          "/team-invitations/accept/details" :
          "/team-invitations/accept",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          code: options.code,
        }),
      },
      options.session,
      [KnownErrors.VerificationCodeError]
    );

    if (res.status === "error") {
      return Result.error(res.error);
    } else {
      return Result.ok(await res.data.json());
    }
  }

  async totpMfa(
    attemptCode: string,
    totp: string,
    session: InternalSession
  ) {
    const res = await this.sendClientRequest("/auth/mfa/sign-in", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        code: attemptCode,
        type: "totp",
        totp: totp,
      }),
    }, session);

    const result = await res.json();
    return {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      newUser: result.is_new_user,
    };
  }

  async signInWithCredential(
    email: string,
    password: string,
    session: InternalSession
  ): Promise<Result<{ accessToken: string, refreshToken: string }, KnownErrors["EmailPasswordMismatch"]>> {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/password/sign-in",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          password,
        }),
      },
      session,
      [KnownErrors.EmailPasswordMismatch]
    );

    if (res.status === "error") {
      return Result.error(res.error);
    }

    const result = await res.data.json();
    return Result.ok({
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
    });
  }

  async signUpWithCredential(
    email: string,
    password: string,
    emailVerificationRedirectUrl: string,
    session: InternalSession,
  ): Promise<Result<{ accessToken: string, refreshToken: string }, KnownErrors["UserWithEmailAlreadyExists"] | KnownErrors["PasswordRequirementsNotMet"]>> {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/password/sign-up",
      {
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          verification_callback_url: emailVerificationRedirectUrl,
        }),
      },
      session,
      [KnownErrors.UserWithEmailAlreadyExists, KnownErrors.PasswordRequirementsNotMet]
    );

    if (res.status === "error") {
      return Result.error(res.error);
    }

    const result = await res.data.json();
    return Result.ok({
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
    });
  }

  async signUpAnonymously(session: InternalSession): Promise<Result<{ accessToken: string, refreshToken: string }, never>> {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/anonymous/sign-up",
      {
        method: "POST",
      },
      session,
      [],
    );

    if (res.status === "error") {
      return Result.error(res.error);
    }

    const result = await res.data.json();
    return Result.ok({
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
    });
  }

  async signInWithMagicLink(code: string): Promise<Result<{ newUser: boolean, accessToken: string, refreshToken: string }, KnownErrors["VerificationCodeError"]>> {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/otp/sign-in",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          code,
        }),
      },
      null,
      [KnownErrors.VerificationCodeError]
    );

    if (res.status === "error") {
      return Result.error(res.error);
    }

    const result = await res.data.json();
    return Result.ok({
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      newUser: result.is_new_user,
    });
  }

  async signInWithPasskey(body: { authentication_response: AuthenticationResponseJSON, code: string }): Promise<Result<{accessToken: string, refreshToken: string }, KnownErrors["PasskeyAuthenticationFailed"]>> {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/passkey/sign-in",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
      },
      null,
      [KnownErrors.PasskeyAuthenticationFailed]
    );

    if (res.status === "error") {
      return Result.error(res.error);
    }

    const result = await res.data.json();
    return Result.ok({
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
    });
  }

  async getOAuthUrl(
    options: {
      provider: string,
      redirectUrl: string,
      errorRedirectUrl: string,
      afterCallbackRedirectUrl?: string,
      codeChallenge: string,
      state: string,
      type: "authenticate" | "link",
      providerScope?: string,
    } & ({ type: "authenticate" } | { type: "link", session: InternalSession })
  ): Promise<string> {
    const updatedRedirectUrl = new URL(options.redirectUrl);
    for (const key of ["code", "state"]) {
      if (updatedRedirectUrl.searchParams.has(key)) {
        console.warn("Redirect URL already contains " + key + " parameter, removing it as it will be overwritten by the OAuth callback");
      }
      updatedRedirectUrl.searchParams.delete(key);
    }

    if (!('publishableClientKey' in this.options)) {
      // TODO fix
      throw new Error("Admin session token is currently not supported for OAuth");
    }
    const url = new URL(this.getApiUrl() + "/auth/oauth/authorize/" + options.provider.toLowerCase());
    url.searchParams.set("client_id", this.projectId);
    url.searchParams.set("client_secret", this.options.publishableClientKey);
    url.searchParams.set("redirect_uri", updatedRedirectUrl.toString());
    url.searchParams.set("scope", "legacy");
    url.searchParams.set("state", options.state);
    url.searchParams.set("grant_type", "authorization_code");
    url.searchParams.set("code_challenge", options.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("type", options.type);
    url.searchParams.set("error_redirect_url", options.errorRedirectUrl);

    if (options.afterCallbackRedirectUrl) {
      url.searchParams.set("after_callback_redirect_url", options.afterCallbackRedirectUrl);
    }

    if (options.type === "link") {
      const tokens = await options.session.getOrFetchLikelyValidTokens(20_000);
      url.searchParams.set("token", tokens?.accessToken.token || "");

      if (options.providerScope) {
        url.searchParams.set("provider_scope", options.providerScope);
      }
    }

    return url.toString();
  }

  async callOAuthCallback(options: {
    oauthParams: URLSearchParams,
    redirectUri: string,
    codeVerifier: string,
    state: string,
  }): Promise<{ newUser: boolean, afterCallbackRedirectUrl?: string, accessToken: string, refreshToken: string }> {
    if (!('publishableClientKey' in this.options)) {
      // TODO fix
      throw new Error("Admin session token is currently not supported for OAuth");
    }
    const as = {
      issuer: this.options.getBaseUrl(),
      algorithm: 'oauth2',
      token_endpoint: this.getApiUrl() + '/auth/oauth/token',
    };
    const client: oauth.Client = {
      client_id: this.projectId,
      client_secret: this.options.publishableClientKey,
      token_endpoint_auth_method: 'client_secret_post',
    };
    const params = await this._networkRetryException(
      async () => oauth.validateAuthResponse(as, client, options.oauthParams, options.state),
    );
    if (oauth.isOAuth2Error(params)) {
      throw new StackAssertionError("Error validating outer OAuth response", { params }); // Handle OAuth 2.0 redirect error
    }
    const response = await oauth.authorizationCodeGrantRequest(
      as,
      client,
      params,
      options.redirectUri,
      options.codeVerifier,
    );

    const result = await oauth.processAuthorizationCodeOAuth2Response(as, client, response);
    if (oauth.isOAuth2Error(result)) {
      if ("code" in result && result.code === "MULTI_FACTOR_AUTHENTICATION_REQUIRED") {
        throw new KnownErrors.MultiFactorAuthenticationRequired((result as any).details.attempt_code);
      }
      // TODO Handle OAuth 2.0 response body error
      throw new StackAssertionError("Outer OAuth error during authorization code response", { result });
    }
    return {
      newUser: result.is_new_user as boolean,
      afterCallbackRedirectUrl: result.after_callback_redirect_url as string | undefined,
      accessToken: result.access_token,
      refreshToken: result.refresh_token ?? throwErr("Refresh token not found in outer OAuth response"),
    };
  }

  async signOut(session: InternalSession): Promise<void> {
    const tokenObj = await session.getOrFetchLikelyValidTokens(20_000);
    if (tokenObj) {
      const resOrError = await this.sendClientRequestAndCatchKnownError(
        "/auth/sessions/current",
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({}),
        },
        session,
        [KnownErrors.RefreshTokenError]
      );
      if (resOrError.status === "error") {
        if (resOrError.error instanceof KnownErrors.RefreshTokenError) {
          // refresh token was already invalid, just continue like nothing happened
        } else {
          // this should never happen
          throw new StackAssertionError("Unexpected error", { error: resOrError.error });
        }
      } else {
        // user was signed out successfully, all good
      }
    }
    session.markInvalid();
  }

  async getClientUserByToken(session: InternalSession): Promise<CurrentUserCrud["Client"]["Read"] | null> {
    const responseOrError = await this.sendClientRequestAndCatchKnownError(
      "/users/me",
      {},
      session,
      [KnownErrors.CannotGetOwnUserWithoutUser],
    );
    if (responseOrError.status === "error") {
      if (responseOrError.error instanceof KnownErrors.CannotGetOwnUserWithoutUser) {
        return null;
      } else {
        throw new StackAssertionError("Unexpected uncaught error", { cause: responseOrError.error });
      }
    }
    const response = responseOrError.data;
    const user: CurrentUserCrud["Client"]["Read"] = await response.json();
    if (!(user as any)) throw new StackAssertionError("User endpoint returned null; this should never happen");
    return user;
  }

  async listTeamInvitations(
    options: {
      teamId: string,
    },
    session: InternalSession,
  ): Promise<TeamInvitationCrud['Client']['Read'][]> {
    const response = await this.sendClientRequest(
      "/team-invitations?" + new URLSearchParams({ team_id: options.teamId }),
      {},
      session,
    );
    const result = await response.json() as TeamInvitationCrud['Client']['List'];
    return result.items;
  }

  async revokeTeamInvitation(
    invitationId: string,
    teamId: string,
    session: InternalSession,
  ) {
    await this.sendClientRequest(
      `/team-invitations/${invitationId}?team_id=${teamId}`,
      { method: "DELETE" },
      session,
    );
  }

  async listTeamMemberProfiles(
    options: {
      teamId?: string,
      userId?: string,
    },
    session: InternalSession,
  ): Promise<TeamMemberProfilesCrud['Client']['Read'][]> {
    const response = await this.sendClientRequest(
      "/team-member-profiles?" + new URLSearchParams(filterUndefined({
        team_id: options.teamId,
        user_id: options.userId,
      })),
      {},
      session,
    );
    const result = await response.json() as TeamMemberProfilesCrud['Client']['List'];
    return result.items;
  }

  async getTeamMemberProfile(
    options: {
      teamId: string,
      userId: string,
    },
    session: InternalSession,
  ): Promise<TeamMemberProfilesCrud['Client']['Read']> {
    const response = await this.sendClientRequest(
      `/team-member-profiles/${options.teamId}/${options.userId}`,
      {},
      session,
    );
    return await response.json();
  }

  async leaveTeam(
    teamId: string,
    session: InternalSession,
  ) {
    await this.sendClientRequest(
      `/team-memberships/${teamId}/me`,
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
      session,
    );
  }

  async updateTeamMemberProfile(
    options: {
      teamId: string,
      userId: string,
      profile: TeamMemberProfilesCrud['Client']['Update'],
    },
    session: InternalSession,
  ) {
    await this.sendClientRequest(
      `/team-member-profiles/${options.teamId}/${options.userId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(options.profile),
      },
      session,
    );
  }

  async updateTeam(
    options: {
      teamId: string,
      data: TeamsCrud['Client']['Update'],
    },
    session: InternalSession,
  ) {
    await this.sendClientRequest(
      `/teams/${options.teamId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(options.data),
      },
      session,
    );
  }

  async listCurrentUserTeamPermissions(
    options: {
      teamId: string,
      recursive: boolean,
    },
    session: InternalSession
  ): Promise<TeamPermissionsCrud['Client']['Read'][]> {
    const response = await this.sendClientRequest(
      `/team-permissions?team_id=${options.teamId}&user_id=me&recursive=${options.recursive}`,
      {},
      session,
    );
    const result = await response.json() as TeamPermissionsCrud['Client']['List'];
    return result.items;
  }

  async listCurrentUserProjectPermissions(
    options: {
      recursive: boolean,
    },
    session: InternalSession
  ): Promise<ProjectPermissionsCrud['Client']['Read'][]> {
    const response = await this.sendClientRequest(
      `/project-permissions?user_id=me&recursive=${options.recursive}`,
      {},
      session,
    );
    const result = await response.json() as ProjectPermissionsCrud['Client']['List'];
    return result.items;
  }

  async listCurrentUserTeams(session: InternalSession): Promise<TeamsCrud["Client"]["Read"][]> {
    const response = await this.sendClientRequest(
      "/teams?user_id=me",
      {},
      session,
    );
    const result = await response.json() as TeamsCrud["Client"]["List"];
    return result.items;
  }

  async getClientProject(): Promise<Result<ProjectsCrud['Client']['Read'], KnownErrors["ProjectNotFound"]>> {
    const responseOrError = await this.sendClientRequestAndCatchKnownError("/projects/current", {}, null, [KnownErrors.ProjectNotFound]);
    if (responseOrError.status === "error") {
      return Result.error(responseOrError.error);
    }
    const response = responseOrError.data;
    const project: ProjectsCrud['Client']['Read'] = await response.json();
    return Result.ok(project);
  }

  async updateClientUser(update: CurrentUserCrud["Client"]["Update"], session: InternalSession) {
    await this.sendClientRequest(
      "/users/me",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(update),
      },
      session,
    );
  }

  async listProjects(session: InternalSession): Promise<InternalProjectsCrud['Client']['Read'][]> {
    const response = await this.sendClientRequest("/internal/projects", {}, session);
    if (!response.ok) {
      throw new Error("Failed to list projects: " + response.status + " " + (await response.text()));
    }

    const json = await response.json() as InternalProjectsCrud['Client']['List'];
    return json.items;
  }

  async createProject(
    project: InternalProjectsCrud['Client']['Create'],
    session: InternalSession,
  ): Promise<InternalProjectsCrud['Client']['Read']> {
    const fetchResponse = await this.sendClientRequest(
      "/internal/projects",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(project),
      },
      session,
    );
    if (!fetchResponse.ok) {
      throw new Error("Failed to create project: " + fetchResponse.status + " " + (await fetchResponse.text()));
    }

    const json = await fetchResponse.json();
    return json;
  }

  async createProviderAccessToken(
    provider: string,
    scope: string,
    session: InternalSession,
  ): Promise<ConnectedAccountAccessTokenCrud['Client']['Read']> {
    const response = await this.sendClientRequest(
      `/connected-accounts/me/${provider}/access-token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ scope }),
      },
      session,
    );
    return await response.json();
  }

  async createClientTeam(
    data: TeamsCrud['Client']['Create'],
    session: InternalSession,
  ): Promise<TeamsCrud['Client']['Read']> {
    const response = await this.sendClientRequest(
      "/teams",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      },
      session,
    );
    return await response.json();
  }

  async deleteTeam(
    teamId: string,
    session: InternalSession,
  ) {
    await this.sendClientRequest(
      `/teams/${teamId}`,
      {
        method: "DELETE",
      },
      session,
    );
  }

  async deleteCurrentUser(session: InternalSession) {
    await this.sendClientRequest(
      "/users/me",
      {
        method: "DELETE",
      },
      session,
    );
  }

  async createClientContactChannel(
    data: ContactChannelsCrud['Client']['Create'],
    session: InternalSession,
  ): Promise<ContactChannelsCrud['Client']['Read']> {
    const response = await this.sendClientRequest(
      "/contact-channels",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      },
      session,
    );
    return await response.json();
  }

  async updateClientContactChannel(
    id: string,
    data: ContactChannelsCrud['Client']['Update'],
    session: InternalSession,
  ): Promise<ContactChannelsCrud['Client']['Read']> {
    const response = await this.sendClientRequest(
      `/contact-channels/me/${id}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      },
      session,
    );
    return await response.json();
  }

  async deleteClientContactChannel(
    id: string,
    session: InternalSession,
  ): Promise<void> {
    await this.sendClientRequest(
      `/contact-channels/me/${id}`,
      {
        method: "DELETE",
      },
      session,
    );
  }

  async deleteSession(
    sessionId: string,
    session: InternalSession,
  ): Promise<void> {
    await this.sendClientRequest(
      `/auth/sessions/${sessionId}?user_id=me`,
      {
        method: "DELETE",
      },
      session,
    );
  }

  async listSessions(
    session: InternalSession,
  ): Promise<SessionsCrud['Client']['List']> {
    const response = await this.sendClientRequest(
      "/auth/sessions?user_id=me",
      {
        method: "GET",
      },
      session,
    );
    return await response.json();
  }


  async listClientContactChannels(
    session: InternalSession,
  ): Promise<ContactChannelsCrud['Client']['Read'][]> {
    const response = await this.sendClientRequest(
      "/contact-channels?user_id=me",
      {
        method: "GET",
      },
      session,
    );
    const json = await response.json() as ContactChannelsCrud['Client']['List'];
    return json.items;
  }

  async sendCurrentUserContactChannelVerificationEmail(
    contactChannelId: string,
    callbackUrl: string,
    session: InternalSession,
  ): Promise<Result<undefined, KnownErrors["EmailAlreadyVerified"]>> {
    const responseOrError = await this.sendClientRequestAndCatchKnownError(
      `/contact-channels/me/${contactChannelId}/send-verification-code`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ callback_url: callbackUrl }),
      },
      session,
      [KnownErrors.EmailAlreadyVerified]
    );

    if (responseOrError.status === "error") {
      return Result.error(responseOrError.error);
    }
    return Result.ok(undefined);
  }

  async cliLogin(
    loginCode: string,
    refreshToken: string,
    session: InternalSession
  ): Promise<Result<undefined, KnownErrors["SchemaError"]>> {
    const responseOrError = await this.sendClientRequestAndCatchKnownError(
      "/auth/cli/complete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          login_code: loginCode,
          refresh_token: refreshToken,
        }),
      },
      session,
      [KnownErrors.SchemaError]
    );

    if (responseOrError.status === "error") {
      return Result.error(responseOrError.error);
    }
    return Result.ok(undefined);
  }

  private async _getApiKeyRequestInfo(options: { user_id: string | null } | { team_id: string }) {
    if ("user_id" in options && "team_id" in options) {
      throw new StackAssertionError("Cannot specify both user_id and team_id in _getApiKeyRequestInfo");
    }

    return {
      endpoint: "team_id" in options ? "/team-api-keys" : "/user-api-keys",
      queryParams: new URLSearchParams(filterUndefinedOrNull(options)),
    };
  }

  // API Keys CRUD operations
  listProjectApiKeys(options: { user_id: string }, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<UserApiKeysCrud['Client']['Read'][]>;
  listProjectApiKeys(options: { team_id: string }, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<TeamApiKeysCrud['Client']['Read'][]>;
  listProjectApiKeys(options: { user_id: string } | { team_id: string }, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<(UserApiKeysCrud['Client']['Read'] | TeamApiKeysCrud['Client']['Read'])[]>;
  async listProjectApiKeys(
    options: { user_id: string } | { team_id: string },
    session: InternalSession | null,
    requestType: "client" | "server" | "admin",
  ): Promise<(UserApiKeysCrud['Client']['Read'] | TeamApiKeysCrud['Client']['Read'])[]> {
    const sendRequest = (requestType === "client" ? this.sendClientRequest : (this as any).sendServerRequest as never).bind(this);
    const { endpoint, queryParams } = await this._getApiKeyRequestInfo(options);

    const response = await sendRequest(
      `${endpoint}?${queryParams.toString()}`,
      {
        method: "GET",
      },
      session,
      requestType,
    );
    const json = await response.json();
    return json.items;
  }

  createProjectApiKey(data: yup.InferType<typeof userApiKeysCreateInputSchema>, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<yup.InferType<typeof userApiKeysCreateOutputSchema>>;
  createProjectApiKey(data: yup.InferType<typeof teamApiKeysCreateInputSchema>, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<yup.InferType<typeof teamApiKeysCreateOutputSchema>>;
  createProjectApiKey(data: yup.InferType<typeof userApiKeysCreateInputSchema> | yup.InferType<typeof teamApiKeysCreateInputSchema>, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<yup.InferType<typeof userApiKeysCreateOutputSchema> | yup.InferType<typeof teamApiKeysCreateOutputSchema>>;
  async createProjectApiKey(
    data: yup.InferType<typeof userApiKeysCreateInputSchema> | yup.InferType<typeof teamApiKeysCreateInputSchema>,
    session: InternalSession | null,
    requestType: "client" | "server" | "admin",
  ): Promise<yup.InferType<typeof userApiKeysCreateOutputSchema> | yup.InferType<typeof teamApiKeysCreateOutputSchema>> {
    const sendRequest = (requestType === "client" ? this.sendClientRequest : (this as any).sendServerRequest as never).bind(this);
    const { endpoint } = await this._getApiKeyRequestInfo(data);

    const response = await sendRequest(
      `${endpoint}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      },
      session,
      requestType,
    );
    return await response.json();
  }

  getProjectApiKey(options: { user_id: string | null }, keyId: string, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<UserApiKeysCrud['Client']['Read']>;
  getProjectApiKey(options: { team_id: string }, keyId: string, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<TeamApiKeysCrud['Client']['Read']>;
  getProjectApiKey(options: { user_id: string | null } | { team_id: string }, keyId: string, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<UserApiKeysCrud['Client']['Read'] | TeamApiKeysCrud['Client']['Read']>;
  async getProjectApiKey(
    options: { user_id: string | null } | { team_id: string },
    keyId: string,
    session: InternalSession | null,
    requestType: "client" | "server" | "admin",
  ): Promise<UserApiKeysCrud['Client']['Read'] | TeamApiKeysCrud['Client']['Read']> {
    const sendRequest = (requestType === "client" ? this.sendClientRequest : (this as any).sendServerRequest as never).bind(this);
    const { endpoint, queryParams } = await this._getApiKeyRequestInfo(options);

    const response = await sendRequest(
      `${endpoint}/${keyId}?${queryParams.toString()}`,
      {
        method: "GET",
      },
      session,
      requestType,
    );
    return await response.json();
  }

  updateProjectApiKey(options: { user_id: string }, keyId: string, data: UserApiKeysCrud['Client']['Update'], session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<UserApiKeysCrud['Client']['Read']>;
  updateProjectApiKey(options: { team_id: string }, keyId: string, data: TeamApiKeysCrud['Client']['Update'], session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<TeamApiKeysCrud['Client']['Read']>;
  updateProjectApiKey(options: { user_id: string } | { team_id: string }, keyId: string, data: UserApiKeysCrud['Client']['Update'] | TeamApiKeysCrud['Client']['Update'], session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<UserApiKeysCrud['Client']['Read'] | TeamApiKeysCrud['Client']['Read']>;
  async updateProjectApiKey(
    options: { user_id: string } | { team_id: string },
    keyId: string,
    data: UserApiKeysCrud['Client']['Update'] | TeamApiKeysCrud['Client']['Update'],
    session: InternalSession | null,
    requestType: "client" | "server" | "admin",
  ): Promise<UserApiKeysCrud['Client']['Read'] | TeamApiKeysCrud['Client']['Read']> {
    const sendRequest = (requestType === "client" ? this.sendClientRequest : (this as any).sendServerRequest as never).bind(this);
    const { endpoint, queryParams } = await this._getApiKeyRequestInfo(options);

    const response = await sendRequest(
      `${endpoint}/${keyId}?${queryParams.toString()}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      },
      session,
      requestType,
    );
    return await response.json();
  }

  checkProjectApiKey(type: "user", apiKey: string, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<UserApiKeysCrud['Client']['Read'] | null>;
  checkProjectApiKey(type: "team", apiKey: string, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<TeamApiKeysCrud['Client']['Read'] | null>;
  checkProjectApiKey(type: "user" | "team", apiKey: string, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<UserApiKeysCrud['Client']['Read'] | TeamApiKeysCrud['Client']['Read'] | null>;
  async checkProjectApiKey(type: "user" | "team", apiKey: string, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<UserApiKeysCrud['Client']['Read'] | TeamApiKeysCrud['Client']['Read'] | null> {
    const sendRequest = (requestType === "client" ? this.sendClientRequestAndCatchKnownError : (this as any).sendServerRequestAndCatchKnownError as never).bind(this);
    const result = await sendRequest(
      `/${type}-api-keys/check`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ api_key: apiKey }),
      },
      session,
      [KnownErrors.ApiKeyNotValid]
    );
    if (result.status === "error") {
      return null;
    }
    return await result.data.json();
  }
}

