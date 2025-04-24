import { AdminUserProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { encodeBase64 } from "@stackframe/stack-shared/dist/utils/bytes";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { filterUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import { nicify } from "@stackframe/stack-shared/dist/utils/strings";
import * as jose from "jose";
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { Context, Mailbox, NiceRequestInit, NiceResponse, STACK_BACKEND_BASE_URL, STACK_INTERNAL_PROJECT_ADMIN_KEY, STACK_INTERNAL_PROJECT_CLIENT_KEY, STACK_INTERNAL_PROJECT_ID, STACK_INTERNAL_PROJECT_SERVER_KEY, STACK_SVIX_SERVER_URL, generatedEmailSuffix, localRedirectUrl, niceFetch, updateCookiesFromResponse } from "../helpers";

type BackendContext = {
  readonly projectKeys: ProjectKeys,
  readonly defaultProjectKeys: ProjectKeys,
  readonly mailbox: Mailbox,
  readonly userAuth: {
    readonly refreshToken?: string,
    readonly accessToken?: string,
  } | null,
  readonly ipData?: {
    readonly ipAddress: string,
    readonly country: string,
    readonly city: string,
    readonly region: string,
    readonly latitude: number,
    readonly longitude: number,
    readonly tzIdentifier: string,
  },
  readonly generatedMailboxNamesCount: number,
};

export const backendContext = new Context<BackendContext, Partial<BackendContext>>(
  () => ({
    defaultProjectKeys: InternalProjectKeys,
    projectKeys: InternalProjectKeys,
    mailbox: createMailbox(`default-mailbox--${randomUUID()}${generatedEmailSuffix}`),
    generatedMailboxNamesCount: 0,
    userAuth: null,
    ipData: undefined,
  }),
  (acc, update) => {
    if ("defaultProjectKeys" in update) {
      throw new StackAssertionError("Cannot set defaultProjectKeys");
    }
    if ("mailbox" in update && !(update.mailbox instanceof Mailbox)) {
      throw new StackAssertionError("Must create a mailbox with createMailbox()!");
    }
    return {
      ...acc,
      ...update,
    };
  },
);

export function createMailbox(email?: string): Mailbox {
  if (email === undefined) {
    backendContext.set({ generatedMailboxNamesCount: backendContext.value.generatedMailboxNamesCount + 1 });
    email = `mailbox-${backendContext.value.generatedMailboxNamesCount}--${randomUUID()}${generatedEmailSuffix}`;
  }
  if (!email.includes("@")) throw new StackAssertionError(`Invalid mailbox email: ${email}`);
  return new Mailbox("(we can ignore the disclaimer here)" as any, email);
}

export type ProjectKeys = "no-project" | {
  projectId: string,
  publishableClientKey?: string,
  secretServerKey?: string,
  superSecretAdminKey?: string,
  adminAccessToken?: string,
};

export const InternalProjectKeys = Object.freeze({
  projectId: STACK_INTERNAL_PROJECT_ID,
  publishableClientKey: STACK_INTERNAL_PROJECT_CLIENT_KEY,
  secretServerKey: STACK_INTERNAL_PROJECT_SERVER_KEY,
  superSecretAdminKey: STACK_INTERNAL_PROJECT_ADMIN_KEY,
});

export const InternalProjectClientKeys = Object.freeze({
  projectId: STACK_INTERNAL_PROJECT_ID,
  publishableClientKey: STACK_INTERNAL_PROJECT_CLIENT_KEY,
});

function expectSnakeCase(obj: unknown, path: string): void {
  if (typeof obj !== "object" || obj === null) return;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      expectSnakeCase(obj[i], `${path}[${i}]`);
    }
  } else {
    for (const [key, value] of Object.entries(obj)) {
      if (key.match(/[a-z0-9][A-Z][a-z0-9]+/) && !key.includes("_") && !["newUser", "afterCallbackRedirectUrl"].includes(key)) {
        throw new StackAssertionError(`Object has camelCase key (expected snake_case): ${path}.${key}`);
      }
      if (["client_metadata", "server_metadata", "options_json", "credential", "authentication_response"].includes(key)) continue;
      // because email templates
      if (path === "req.body.content.root") continue;
      if (path === "res.body.content.root") continue;
      expectSnakeCase(value, `${path}.${key}`);
    }
  }
}

export async function niceBackendFetch(url: string | URL, options?: Omit<NiceRequestInit, "body" | "headers"> & {
  accessType?: null | "client" | "server" | "admin",
  body?: unknown,
  headers?: Record<string, string | undefined>,
}): Promise<NiceResponse> {
  const { body, headers, accessType, ...otherOptions } = options ?? {};
  if (typeof body === "object") {
    expectSnakeCase(body, "req.body");
  }
  const { projectKeys, userAuth } = backendContext.value;
  const fullUrl = new URL(url, STACK_BACKEND_BASE_URL);
  if (fullUrl.origin !== new URL(STACK_BACKEND_BASE_URL).origin) throw new StackAssertionError(`Invalid niceBackendFetch origin: ${fullUrl.origin}`);
  if (fullUrl.protocol !== new URL(STACK_BACKEND_BASE_URL).protocol) throw new StackAssertionError(`Invalid niceBackendFetch protocol: ${fullUrl.protocol}`);
  const res = await niceFetch(fullUrl, {
    ...otherOptions,
    ...body !== undefined ? { body: JSON.stringify(body) } : {},
    headers: filterUndefined({
      "content-type": body !== undefined ? "application/json" : undefined,
      "x-stack-access-type": accessType ?? undefined,
      ...projectKeys !== "no-project" && accessType ? {
        "x-stack-project-id": projectKeys.projectId,
        "x-stack-publishable-client-key": projectKeys.publishableClientKey,
        "x-stack-secret-server-key": projectKeys.secretServerKey,
        "x-stack-super-secret-admin-key": projectKeys.superSecretAdminKey,
        'x-stack-admin-access-token': projectKeys.adminAccessToken,
      } : {},
      "x-stack-access-token": userAuth?.accessToken,
      "x-stack-refresh-token": userAuth?.refreshToken,
      ...backendContext.value.ipData ? {
        "user-agent": "Mozilla/5.0",  // pretend to be a browser so our IP gets tracked
        "x-forwarded-for": backendContext.value.ipData.ipAddress,
        "cf-connecting-ip": backendContext.value.ipData.ipAddress,
        "x-vercel-ip-country": backendContext.value.ipData.country,
        "cf-ipcountry": backendContext.value.ipData.country,
        "x-vercel-ip-country-region": backendContext.value.ipData.region,
        "x-vercel-ip-city": backendContext.value.ipData.city,
        "x-vercel-ip-latitude": backendContext.value.ipData.latitude.toString(),
        "x-vercel-ip-longitude": backendContext.value.ipData.longitude.toString(),
        "x-vercel-ip-timezone": backendContext.value.ipData.tzIdentifier,
      } : {},
      ...Object.fromEntries(new Headers(filterUndefined(headers ?? {}) as any).entries()),
    }),
  });
  if (res.status >= 500 && res.status < 600) {
    throw new StackAssertionError(`Unexpected internal server error: ${res.status} ${typeof res.body === "string" ? res.body : nicify(res.body)}`);
  }
  if (res.headers.has("x-stack-known-error")) {
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body).toMatchObject({
      code: res.headers.get("x-stack-known-error"),
    });
  }
  if (typeof res.body === "object" && res.body) {
    expectSnakeCase(res.body, "res.body");
  }
  return res;
}


/**
 * Creates a new mailbox with a different email address, and sets it as the current mailbox.
 */
export async function bumpEmailAddress(options: { unindexed?: boolean } = {}) {
  let emailAddress = undefined;
  if (options.unindexed) {
    emailAddress = `unindexed-mailbox--${randomUUID()}${generatedEmailSuffix}`;
  }
  const mailbox = createMailbox(emailAddress);
  backendContext.set({ mailbox });
  return mailbox;
}

export namespace Auth {
  export async function ensureParsableAccessToken() {
    const accessToken = backendContext.value.userAuth?.accessToken;
    if (accessToken) {
      const aud = jose.decodeJwt(accessToken).aud;
      const jwks = jose.createRemoteJWKSet(
        new URL(`api/v1/projects/${aud}/.well-known/jwks.json`, STACK_BACKEND_BASE_URL),
        { timeoutDuration: 10_000 },
      );
      const { payload } = await jose.jwtVerify(accessToken, jwks);
      expect(payload).toEqual({
        "exp": expect.any(Number),
        "iat": expect.any(Number),
        "iss": "https://access-token.jwt-signature.stack-auth.com",
        "refreshTokenId": expect.any(String),
        "aud": expect.any(String),
        "sub": expect.any(String),
        "role": "authenticated",
        "branchId": "main",
      });
    }
  }

  /**
   * Valid session & valid access token: OK
   * Valid session & invalid access token: OK
   * Invalid session & valid access token: Error
   * Invalid session & invalid access token: Error
   */
  export async function expectSessionToBeValid() {
    const response = await niceBackendFetch("/api/v1/auth/sessions/current/refresh", { method: "POST", accessType: "client" });
    if (response.status !== 200) {
      throw new StackAssertionError("Expected session to be valid, but was actually invalid.", { response });
    }
    expect(response).toMatchObject({
      status: 200,
      headers: expect.objectContaining({}),
      body: expect.objectContaining({}),
    });
  }

  /**
   * Valid session & valid access token: Error
   * Valid session & invalid access token: Error
   * Invalid session & valid access token: OK
   * Invalid session & invalid access token: OK
   */
  export async function expectSessionToBeInvalid() {
    const response = await niceBackendFetch("/api/v1/auth/sessions/current/refresh", { method: "POST", accessType: "client" });
    expect(response.status).not.toEqual(200);
  }

  /**
   * Valid session & valid access token: OK
   * Valid session & invalid access token: Error
   * Invalid session & valid access token: OK
   * Invalid session & invalid access token: Error
   */
  export async function expectAccessTokenToBeInvalid() {
    await ensureParsableAccessToken();
    const response = await niceBackendFetch("/api/v1/users/me", { accessType: "client" });
    if (response.status === 200) {
      throw new StackAssertionError("Expected access token to be invalid, but was actually valid.", { response });
    }
  }

  /**
   * Valid session & valid access token: OK
   * Valid session & invalid access token: Error
   * Invalid session & valid access token: OK
   * Invalid session & invalid access token: Error
   */
  export async function expectAccessTokenToBeValid() {
    await ensureParsableAccessToken();
    const response = await niceBackendFetch("/api/v1/users/me", { accessType: "client" });
    if (response.status !== 200) {
      throw new StackAssertionError("Expected access token to be valid, but was actually invalid.", { response });
    }
  }

  /**
   * Valid session & valid access token: OK
   * Valid session & invalid access token: Error
   * Invalid session & valid access token: Error
   * Invalid session & invalid access token: Error
   *
   * (see comment in the function for rationale, and why "invalid refresh token but valid access token" is not
   * considered "signed in")
   */
  export async function expectToBeSignedIn() {
    // there is a world where we would accept either access token OR session to be "signed in", instead of both
    // however, it's better to be strict and throw an error if either is invalid; this helps catch bugs
    // if you really want to check only one of them, use expectSessionToBeValid or expectAccessTokenToBeValid
    // for more information, see the comment in expectToBeSignedOut
    await Auth.expectAccessTokenToBeValid();
    await Auth.expectSessionToBeValid();
  }

  /**
   * Valid session & valid access token: Error
   * Valid session & invalid access token: Error
   * Invalid session & valid access token: Error
   * Invalid session & invalid access token: OK
   */
  export async function expectToBeSignedOut() {
    await Auth.expectAccessTokenToBeInvalid();

    // usually, when we mean "signed out" we mean "both access token AND session are invalid"; we'd rather be strict
    // so, we additionally check the session
    // this has the weird side effect that expectToBeSignedIn (which is also strict, checking that access token AND
    // session are valid) may throw, even if expectToBeSignedOut also throws
    // if you run into something like that in your tests, use expectSessionToBeInvalid instead
    await Auth.expectSessionToBeInvalid();
  }

  export async function signOut() {
    const response = await niceBackendFetch("/api/v1/auth/sessions/current", {
      method: "DELETE",
      accessType: "client",
    });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "success": true },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
    if (backendContext.value.userAuth) backendContext.set({ userAuth: { ...backendContext.value.userAuth, accessToken: undefined } });
    await Auth.expectToBeSignedOut();
    return {
      signOutResponse: response,
    };
  }

  export namespace Otp {
    export async function sendSignInCode() {
      const mailbox = backendContext.value.mailbox;
      const response = await niceBackendFetch("/api/v1/auth/otp/send-sign-in-code", {
        method: "POST",
        accessType: "client",
        body: {
          email: mailbox.emailAddress,
          callback_url: "http://localhost:12345/some-callback-url",
        },
      });
      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 200,
          "body": { "nonce": <stripped field 'nonce'> },
          "headers": Headers { <some fields may have been hidden> },
        }
      `);
      const messages = await mailbox.fetchMessages({ noBody: true });
      const subjects = messages.map((message) => message.subject);
      const containsSubstring = subjects.some(str => str.includes("Sign in to"));
      expect(containsSubstring).toBe(true);
      return {
        sendSignInCodeResponse: response,
      };
    }

    export async function signIn() {
      const sendSignInCodeRes = await sendSignInCode();
      const signInResult = await signInWithCode(await getSignInCodeFromMailbox());
      return {
        ...sendSignInCodeRes,
        ...signInResult,
      };
    }

    export async function getSignInCodeFromMailbox() {
      const mailbox = backendContext.value.mailbox;
      const messages = await mailbox.fetchMessages();
      const message = messages.findLast((message) => message.subject.includes("Sign in to")) ?? throwErr("Sign-in code message not found");
      const signInCode = message.body?.text.match(/http:\/\/localhost:12345\/some-callback-url\?code=([a-zA-Z0-9]+)/)?.[1] ?? throwErr("Sign-in URL not found");
      return signInCode;
    }

    export async function signInWithCode(signInCode: string) {
      const response = await niceBackendFetch("/api/v1/auth/otp/sign-in", {
        method: "POST",
        accessType: "client",
        body: {
          code: signInCode,
        },
      });
      expect(response).toMatchObject({
        status: 200,
        body: {
          access_token: expect.any(String),
          refresh_token: expect.any(String),
          is_new_user: expect.any(Boolean),
          user_id: expect.any(String),
        },
        headers: expect.anything(),
      });

      backendContext.set({
        userAuth: {
          accessToken: response.body.access_token,
          refreshToken: response.body.refresh_token,
        },
      });

      return {
        userId: response.body.user_id,
        signInResponse: response,
      };
    }
  }

  export namespace Password {
    export async function signUpWithEmail(options: { password?: string } = {}) {
      const mailbox = backendContext.value.mailbox;
      const email = mailbox.emailAddress;
      const password = options.password ?? generateSecureRandomString();
      const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email,
          password,
          verification_callback_url: "http://localhost:12345/some-callback-url",
        },
      });
      expect(response).toMatchObject({
        status: 200,
        body: {
          access_token: expect.any(String),
          refresh_token: expect.any(String),
          user_id: expect.any(String),
        },
        headers: expect.anything(),
      });

      backendContext.set({
        userAuth: {
          accessToken: response.body.access_token,
          refreshToken: response.body.refresh_token,
        },
      });

      return {
        signUpResponse: response,
        userId: response.body.user_id,
        email,
        password,
      };
    }

    export async function signInWithEmail(options: { password: string }) {
      const mailbox = backendContext.value.mailbox;
      const email = mailbox.emailAddress;
      const response = await niceBackendFetch("/api/v1/auth/password/sign-in", {
        method: "POST",
        accessType: "client",
        body: {
          email,
          password: options.password,
        },
      });
      expect(response).toMatchObject({
        status: 200,
        body: {
          access_token: expect.any(String),
          refresh_token: expect.any(String),
          user_id: expect.any(String),
        },
        headers: expect.anything(),
      });

      backendContext.set({
        userAuth: {
          accessToken: response.body.access_token,
          refreshToken: response.body.refresh_token,
        },
      });

      return {
        signInResponse: response,
        userId: response.body.user_id,
      };
    }
  }

  export namespace Passkey {


    export async function register() {
      const initiateRegistrationRes = await Auth.Passkey.initiateRegistration();

      const response = await niceBackendFetch("/api/v1/auth/passkey/register", {
        method: "POST",
        accessType: "client",
        body: {
          "credential": {
            "id": "BBYYB_DKzPZHm1o6ILGo6Sk_cBc",
            "rawId": "BBYYB_DKzPZHm1o6ILGo6Sk_cBc",
            "response": {
              "attestationObject": "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YViYSZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2NdAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAQWGAfwysz2R5taOiCxqOkpP3AXpQECAyYgASFYIO7JJihe93CDhZOPFp9pVefZyBvy62JMjSs47id1q0vpIlggNMjLAQG7ESYqRZsBQbX07WWIImEzYFDsJgBOSYiQZL8",
              "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiVFU5RFN3Iiwib3JpZ2luIjoiaHR0cDovL2xvY2FsaG9zdDo4MTAzIiwiY3Jvc3NPcmlnaW4iOmZhbHNlfQ",
              "transports": [
                "hybrid",
                "internal"
              ],
              "publicKeyAlgorithm": -7,
              "publicKey": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7skmKF73cIOFk48Wn2lV59nIG_LrYkyNKzjuJ3WrS-k0yMsBAbsRJipFmwFBtfTtZYgiYTNgUOwmAE5JiJBkvw",
              "authenticatorData": "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2NdAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAQWGAfwysz2R5taOiCxqOkpP3AXpQECAyYgASFYIO7JJihe93CDhZOPFp9pVefZyBvy62JMjSs47id1q0vpIlggNMjLAQG7ESYqRZsBQbX07WWIImEzYFDsJgBOSYiQZL8"
            },
            "type": "public-key",
            "clientExtensionResults": {
              "credProps": {
                "rk": true
              }
            },
            "authenticatorAttachment": "platform"
          },
          "code": initiateRegistrationRes.code,
        },
      });

      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 200,
          "body": { "user_handle": "BBYYB_DKzPZHm1o6ILGo6Sk_cBc" },
          "headers": Headers { <some fields may have been hidden> },
        }
      `);
    }

    export async function initiateRegistration(): Promise<{ code: string }> {
      const response = await niceBackendFetch("/api/v1/auth/passkey/initiate-passkey-registration", {
        method: "POST",
        accessType: "client",
        body: {},
      });
      const original_code = response.body.code;
      response.body.options_json.user.id = "<stripped encoded UUID>";
      response.body.code = "<stripped code>";

      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 200,
          "body": {
            "code": "<stripped code>",
            "options_json": {
              "attestation": "none",
              "authenticatorSelection": {
                "requireResidentKey": true,
                "residentKey": "required",
                "userVerification": "preferred",
              },
              "challenge": "TU9DSw",
              "excludeCredentials": [],
              "extensions": { "credProps": true },
              "pubKeyCredParams": [
                {
                  "alg": -8,
                  "type": "public-key",
                },
                {
                  "alg": -7,
                  "type": "public-key",
                },
                {
                  "alg": -257,
                  "type": "public-key",
                },
              ],
              "rp": {
                "id": "THIS_VALUE_WILL_BE_REPLACED.example.com",
                "name": "New Project",
              },
              "timeout": 60000,
              "user": {
                "displayName": "default-mailbox--<stripped UUID>@stack-generated.example.com",
                "id": "<stripped encoded UUID>",
                "name": "default-mailbox--<stripped UUID>@stack-generated.example.com",
              },
            },
          },
          "headers": Headers { <some fields may have been hidden> },
        }
      `);
      return {
        code: original_code,
      };
    }
  }


  export namespace OAuth {
    export async function getAuthorizeQuery() {
      const projectKeys = backendContext.value.projectKeys;
      if (projectKeys === "no-project") throw new Error("No project keys found in the backend context");

      return {
        client_id: projectKeys.projectId,
        client_secret: projectKeys.publishableClientKey ?? throwErr("No publishable client key found in the backend context"),
        redirect_uri: localRedirectUrl,
        scope: "legacy",
        response_type: "code",
        state: "this-is-some-state",
        grant_type: "authorization_code",
        code_challenge: "some-code-challenge",
        code_challenge_method: "plain",
      };
    }

    export async function authorize(options?: { redirectUrl?: string, errorRedirectUrl?: string }) {
      const response = await niceBackendFetch("/api/v1/auth/oauth/authorize/spotify", {
        redirect: "manual",
        query: {
          ...await Auth.OAuth.getAuthorizeQuery(),
          ...filterUndefined({
            redirect_uri: options?.redirectUrl ?? undefined,
            error_redirect_uri: options?.errorRedirectUrl ?? undefined,
          }),
        },
      });
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toMatch(/^http:\/\/localhost:8114\/auth\?.*$/);
      expect(response.headers.get("set-cookie")).toMatch(/^stack-oauth-inner-[^;]+=[^;]+; Path=\/; Expires=[^;]+; Max-Age=\d+;( Secure;)? HttpOnly$/);
      return {
        authorizeResponse: response,
      };
    }

    export async function getInnerCallbackUrl(options?: { authorizeResponse: NiceResponse }) {
      options ??= await Auth.OAuth.authorize();
      const providerPassword = generateSecureRandomString();
      const authLocation = new URL(options.authorizeResponse.headers.get("location")!);
      const redirectResponse1 = await niceFetch(authLocation, {
        redirect: "manual",
      });
      expect(redirectResponse1).toMatchObject({
        status: 303,
        headers: expect.any(Headers),
        body: expect.any(String),
      });
      const signInInteractionLocation = new URL(redirectResponse1.headers.get("location") ?? throwErr("missing redirect location", { redirectResponse1 }), authLocation);
      const signInInteractionCookies = updateCookiesFromResponse("", redirectResponse1);
      const response1 = await niceFetch(signInInteractionLocation, {
        method: "POST",
        redirect: "manual",
        body: new URLSearchParams({
          prompt: "login",
          login: backendContext.value.mailbox.emailAddress,
          password: providerPassword,
        }),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: signInInteractionCookies,
        },
      });
      expect(response1).toMatchObject({
        status: 303,
        headers: expect.any(Headers),
        body: expect.any(ArrayBuffer),
      });
      const redirectResponse2 = await niceFetch(new URL(response1.headers.get("location") ?? throwErr("missing redirect location", { response1 }), signInInteractionLocation), {
        redirect: "manual",
        headers: {
          cookie: updateCookiesFromResponse(signInInteractionCookies, response1),
        },
      });
      expect(redirectResponse2).toMatchObject({
        status: 303,
        headers: expect.any(Headers),
        body: expect.any(String),
      });
      const authorizeInteractionLocation = new URL(redirectResponse2.headers.get("location") ?? throwErr("missing redirect location", { redirectResponse2 }), authLocation);
      const authorizeInteractionCookies = updateCookiesFromResponse(signInInteractionCookies, redirectResponse2);
      const response2 = await niceFetch(authorizeInteractionLocation, {
        method: "POST",
        redirect: "manual",
        body: new URLSearchParams({
          prompt: "consent",
        }),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: authorizeInteractionCookies,
        },
      });
      expect(response2).toMatchObject({
        status: 303,
        headers: expect.any(Headers),
        body: expect.any(ArrayBuffer),
      });
      const redirectResponse3 = await niceFetch(new URL(response2.headers.get("location") ?? throwErr("missing redirect location", { response2 }), authLocation), {
        redirect: "manual",
        headers: {
          cookie: updateCookiesFromResponse(authorizeInteractionCookies, response2),
        },
      });
      expect(redirectResponse3).toMatchObject({
        status: 303,
        headers: expect.any(Headers),
        body: expect.any(String),
      });
      const innerCallbackUrl = new URL(redirectResponse3.headers.get("location") ?? throwErr("missing redirect location", { redirectResponse3 }));
      expect(innerCallbackUrl.origin).toBe("http://localhost:8102");
      expect(innerCallbackUrl.pathname).toBe("/api/v1/auth/oauth/callback/spotify");
      return {
        ...options,
        innerCallbackUrl,
      };
    }

    export async function getAuthorizationCode(options?: { innerCallbackUrl: URL, authorizeResponse: NiceResponse }) {
      options ??= await Auth.OAuth.getInnerCallbackUrl();
      const cookie = updateCookiesFromResponse("", options.authorizeResponse);
      const response = await niceBackendFetch(options.innerCallbackUrl.toString(), {
        redirect: "manual",
        headers: {
          cookie,
        },
      });
      expect(response).toMatchObject({
        status: 307,
        headers: expect.any(Headers),
        body: {},
      });
      const outerCallbackUrl = new URL(response.headers.get("location") ?? throwErr("missing redirect location", { response }));
      expect(outerCallbackUrl.origin).toBe(new URL(localRedirectUrl).origin);
      expect(outerCallbackUrl.pathname).toBe(new URL(localRedirectUrl).pathname);
      expect(Object.fromEntries(outerCallbackUrl.searchParams.entries())).toEqual({
        code: expect.any(String),
        state: "this-is-some-state",
      });

      return {
        callbackResponse: response,
        outerCallbackUrl,
        authorizationCode: outerCallbackUrl.searchParams.get("code")!,
      };
    }

    export async function signIn() {
      const getAuthorizationCodeResult = await Auth.OAuth.getAuthorizationCode();

      const projectKeys = backendContext.value.projectKeys;
      if (projectKeys === "no-project") throw new Error("No project keys found in the backend context");

      const tokenResponse = await niceBackendFetch("/api/v1/auth/oauth/token", {
        method: "POST",
        accessType: "client",
        body: {
          client_id: projectKeys.projectId,
          client_secret: projectKeys.publishableClientKey ?? throwErr("No publishable client key found in the backend context"),
          code: getAuthorizationCodeResult.authorizationCode,
          redirect_uri: localRedirectUrl,
          code_verifier: "some-code-challenge",
          grant_type: "authorization_code",
        },
      });
      expect(tokenResponse).toMatchObject({
        status: 200,
        body: {
          access_token: expect.any(String),
          afterCallbackRedirectUrl: null,
          after_callback_redirect_url: null,
          refresh_token: expect.any(String),
          scope: "legacy",
          token_type: "Bearer"
        },
      });

      backendContext.set({
        userAuth: {
          accessToken: tokenResponse.body.access_token,
          refreshToken: tokenResponse.body.refresh_token,
        },
      });

      return {
        ...getAuthorizationCodeResult,
        tokenResponse,
      };
    }
  }

  export namespace Mfa {
    export async function setupTotpMfa() {
      const totpSecretBytes = crypto.getRandomValues(new Uint8Array(20));
      const totpSecretBase64 = encodeBase64(totpSecretBytes);
      const response = await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
        method: "PATCH",
        body: {
          totp_secret_base64: totpSecretBase64,
        },
      });
      expect(response).toMatchObject({
        status: 200,
      });

      return {
        setupTotpMfaResponse: response,
        totpSecret: totpSecretBytes,
      };
    }
  }

  export namespace Anonymous {
    export async function signUp() {
      const response = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
        method: "POST",
        accessType: "client",
      });
      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 200,
          "body": {
            "access_token": <stripped field 'access_token'>,
            "refresh_token": <stripped field 'refresh_token'>,
            "user_id": "<stripped UUID>",
          },
          "headers": Headers { <some fields may have been hidden> },
        }
      `);
      backendContext.set({
        userAuth: {
          accessToken: response.body.access_token,
          refreshToken: response.body.refresh_token,
        },
      });
      return { response };
    }
  }
}

export namespace ContactChannels {
  export async function getTheOnlyContactChannel() {
    const contactChannels = await ContactChannels.listAllCurrentUserContactChannels();
    expect(contactChannels).toHaveLength(1);
    return contactChannels[0];
  }

  export async function listAllCurrentUserContactChannels() {
    const response = await niceBackendFetch("/api/v1/contact-channels?user_id=me", {
      accessType: "client",
    });
    return response.body.items;
  }

  export async function sendVerificationCode(options?: { contactChannelId?: string }) {
    const contactChannelId = options?.contactChannelId ?? (await ContactChannels.getTheOnlyContactChannel()).id;
    const mailbox = backendContext.value.mailbox;
    const response = await niceBackendFetch(`/api/v1/contact-channels/me/${contactChannelId}/send-verification-code`, {
      method: "POST",
      accessType: "client",
      body: {
        callback_url: "http://localhost:12345/some-callback-url",
      },
    });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "success": true },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
    const messages = await mailbox.fetchMessages({ noBody: true });
    const subjects = messages.map((message) => message.subject);
    expect(subjects[0].includes("Verify your email")).toBe(true);
    return {
      sendSignInCodeResponse: response,
    };
  }

  export async function verify(options?: { contactChannelId?: string }) {
    const mailbox = backendContext.value.mailbox;
    const sendVerificationCodeRes = await sendVerificationCode(options);
    const messages = await mailbox.fetchMessages();
    const message = messages.findLast((message) => message.subject.includes("Verify your email")) ?? throwErr("Verification code message not found");
    const verificationCode = message.body?.text.match(/http:\/\/localhost:12345\/some-callback-url\?code=([a-zA-Z0-9]+)/)?.[1] ?? throwErr("Verification code not found");
    const response = await niceBackendFetch("/api/v1/contact-channels/verify", {
      method: "POST",
      accessType: "client",
      body: {
        code: verificationCode,
      },
    });
    expect(response).toMatchInlineSnapshot(`
          NiceResponse {
            "status": 200,
            "body": { "success": true },
            "headers": Headers { <some fields may have been hidden> },
          }
        `);
    return {
      ...sendVerificationCodeRes,
      verifyResponse: response,
    };
  }
}

export namespace ProjectApiKey {
  export namespace User {
    export async function create(data?: any) {
      const response = await niceBackendFetch("/api/v1/user-api-keys", {
        method: "POST",
        accessType: "server",
        body: data,
      });
      expect(response.status).toEqual(200);
      return {
        createUserApiKeyResponse: response,
      };
    }

    export async function check(apiKey: string) {
      const response = await niceBackendFetch(`/api/v1/user-api-keys/check`, {
        method: "POST",
        accessType: "server",
        body: {
          api_key: apiKey,
        },
      });
      expect(response.status).oneOf([200, 401, 404]);
      return response.body;
    }

    export async function revoke(apiKeyId: string) {
      const response = await niceBackendFetch(`/api/v1/user-api-keys/${apiKeyId}`, {
        method: "PATCH",
        accessType: "server",
        body: {
          revoked: true,
        },
      });
      return response;
    }
  }

  export namespace Team {
    export async function create(body?: any) {
      const response = await niceBackendFetch("/api/v1/team-api-keys", {
        method: "POST",
        accessType: "client",
        body,
      });
      expect(response.status).toEqual(200);
      return {
        createTeamApiKeyResponse: response,
      };
    }

    export async function check(apiKey: string) {
      const response = await niceBackendFetch(`/api/v1/team-api-keys/check`, {
        method: "POST",
        accessType: "server",
        body: {
          api_key: apiKey,
        },
      });
      expect(response.status).oneOf([200, 401, 404]);
      return response.body;
    }


    export async function revoke(apiKeyId: string) {
      const response = await niceBackendFetch(`/api/v1/team-api-keys/${apiKeyId}`, {
        method: "PATCH",
        accessType: "server",
        body: {
          revoked: true,
        },
      });
      return response;
    }
  }
}

export namespace InternalApiKey {
  export async function create(adminAccessToken?: string, body?: any) {
    const oldProjectKeys = backendContext.value.projectKeys;
    if (oldProjectKeys === 'no-project') {
      throw new Error("Cannot set API key context without a project");
    }

    const response = await niceBackendFetch("/api/v1/internal/api-keys", {
      accessType: "admin",
      method: "POST",
      body: {
        description: "test api key",
        has_publishable_client_key: true,
        has_secret_server_key: true,
        has_super_secret_admin_key: true,
        expires_at_millis: new Date().getTime() + 1000 * 60 * 60 * 24,
        ...body,
      },
      headers: {
        'x-stack-admin-access-token': adminAccessToken ?? (backendContext.value.projectKeys !== "no-project" && backendContext.value.projectKeys.adminAccessToken || throwErr("Missing adminAccessToken")),
      }
    });
    expect(response.status).equals(200);

    return {
      createApiKeyResponse: response,
      projectKeys: {
        projectId: oldProjectKeys.projectId,
        publishableClientKey: response.body.publishable_client_key,
        secretServerKey: response.body.secret_server_key,
        superSecretAdminKey: response.body.super_secret_admin_key,
      },
    };
  }

  export async function createAndSetProjectKeys(adminAccessToken?: string, body?: any) {
    const res = await InternalApiKey.create(adminAccessToken, body);
    backendContext.set({ projectKeys: res.projectKeys });
    return res;
  }

  export async function list() {
    const response = await niceBackendFetch("/api/v1/internal/api-keys", {
      accessType: "admin",
    });
    expect(response.status).toBe(200);
    return response.body;
  }
}

export namespace Project {
  export async function create(body?: any) {
    const response = await niceBackendFetch("/api/v1/internal/projects", {
      accessType: "client",
      method: "POST",
      body: {
        display_name: body?.display_name || 'New Project',
        ...body,
      },
    });
    expect(response).toMatchObject({
      status: 201,
      body: {
        id: expect.any(String),
      },
    });
    return {
      createProjectResponse: response,
      projectId: response.body.id as string,
    };
  }

  export async function updateCurrent(adminAccessToken: string, body: Partial<AdminUserProjectsCrud["Admin"]["Create"]>) {
    const response = await niceBackendFetch(`/api/v1/internal/projects/current`, {
      accessType: "admin",
      method: "PATCH",
      body,
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      }
    });

    return {
      updateProjectResponse: response,
    };
  }

  export async function createAndGetAdminToken(body?: Partial<AdminUserProjectsCrud["Admin"]["Create"]>) {
    backendContext.set({
      projectKeys: InternalProjectKeys,
      userAuth: null,
    });
    const oldMailbox = backendContext.value.mailbox;
    await bumpEmailAddress({ unindexed: true });
    const { userId } = await Auth.Otp.signIn();
    const adminAccessToken = backendContext.value.userAuth?.accessToken;
    expect(adminAccessToken).toBeDefined();
    const { projectId, createProjectResponse } = await Project.create(body);

    backendContext.set({
      projectKeys: {
        projectId,
      },
      userAuth: null,
      mailbox: oldMailbox,
    });

    return {
      creatorUserId: userId,
      projectId,
      adminAccessToken: adminAccessToken!,
      createProjectResponse,
    };
  }

  export async function createAndSwitch(body?: Partial<AdminUserProjectsCrud["Admin"]["Create"]>) {
    const createResult = await Project.createAndGetAdminToken(body);
    backendContext.set({
      projectKeys: {
        projectId: createResult.projectId,
        adminAccessToken: createResult.adminAccessToken,
      },
    });
    return createResult;
  }
}

export namespace Team {
  export async function create(options: { accessType?: "client" | "server", addCurrentUser?: boolean, creatorUserId?: string } = {}, body?: any) {
    const displayName = body?.display_name || 'New Team';
    const response = await niceBackendFetch("/api/v1/teams", {
      accessType: options.accessType ?? "server",
      method: "POST",
      body: {
        display_name: displayName,
        creator_user_id: options.creatorUserId ?? (options.addCurrentUser ? 'me' : undefined),
        ...body,
      },
    });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 201,
        "body": {
          "client_metadata": null,
          "client_read_only_metadata": null,
          "created_at_millis": <stripped field 'created_at_millis'>,
          "display_name": ${JSON.stringify(displayName)},
          "id": "<stripped UUID>",
          "profile_image_url": null,
          "server_metadata": null,
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
    return {
      createTeamResponse: response,
      teamId: response.body.id,
    };
  }

  export async function createAndAddCurrent(options: { accessType?: "client" | "server" } = {}, body?: any) {
    return await Team.create({ ...options, addCurrentUser: true }, body);
  }

  export async function addMember(teamId: string, userId: string) {
    const response = await niceBackendFetch(`/api/v1/team-memberships/${teamId}/${userId}`, {
      method: "POST",
      accessType: "server",
      body: {},
    });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 201,
        "body": {
          "team_id": "<stripped UUID>",
          "user_id": "<stripped UUID>",
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  }

  export async function addPermission(teamId: string, userId: string, permissionId: string) {
    const response = await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${userId}/${permissionId}`, {
      method: "POST",
      accessType: "server",
      body: {},
    });
    return response;
  }

  export async function sendInvitation(mail: string | Mailbox, teamId: string) {
    const response = await niceBackendFetch("/api/v1/team-invitations/send-code", {
      method: "POST",
      accessType: "client",
      body: {
        email: typeof mail === 'string' ? mail : mail.emailAddress,
        team_id: teamId,
        callback_url: "http://localhost:12345/some-callback-url",
      },
    });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "id": "<stripped UUID>",
          "success": true,
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    return {
      sendTeamInvitationResponse: response,
    };
  }

  export async function acceptInvitation() {
    const mailbox = backendContext.value.mailbox;
    const messages = await mailbox.fetchMessages();
    const message = messages.findLast((message) => message.subject.includes("join")) ?? throwErr("Team invitation message not found");
    const code = message.body?.text.match(/http:\/\/localhost:12345\/some-callback-url\?code=([a-zA-Z0-9]+)/)?.[1] ?? throwErr("Team invitation code not found");
    const response = await niceBackendFetch("/api/v1/team-invitations/accept", {
      method: "POST",
      accessType: "client",
      body: {
        code,
      },
    });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {},
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
    return {
      acceptTeamInvitationResponse: response,
    };
  }
}

export namespace User {
  export function setBackendContextFromUser({ mailbox, accessToken, refreshToken }: {mailbox: Mailbox, accessToken: string, refreshToken: string}) {
      backendContext.set({
        mailbox,
        userAuth: {
          accessToken,
          refreshToken,
        },
      });
  }


  export async function create({ emailAddress }: {emailAddress?: string} = {}) {
    // Create new mailbox
    const email = emailAddress ?? `unindexed-mailbox--${randomUUID()}${generatedEmailSuffix}`;
    const mailbox = createMailbox(email);
    const password = generateSecureRandomString();
    const createUserResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email,
        password,
        verification_callback_url: "http://localhost:12345/some-callback-url",
      },
    });
      expect(createUserResponse).toMatchObject({
        status: 200,
        body: {
          access_token: expect.any(String),
          refresh_token: expect.any(String),
          user_id: expect.any(String),
        },
        headers: expect.anything(),
      });
      return {
        userId: createUserResponse.body.user_id,
        mailbox,
        accessToken: createUserResponse.body.access_token,
        refreshToken: createUserResponse.body.refresh_token,
      };
  }

  export async function createMultiple(count: number) {
    const users = [];
    for (let i = 0; i < count; i++) {
      const user = await User.create({});
        users.push(user);
    }
    return users;
  }
}


export namespace Webhook {
  export async function createProjectWithEndpoint() {
    const { projectId } = await Project.createAndSwitch({
      config: {
        magic_link_enabled: true,
      }
    });

    const svixTokenResponse = await niceBackendFetch("/api/v1/webhooks/svix-token", {
      accessType: "admin",
      method: "POST",
      body: {},
    });

    const svixToken = svixTokenResponse.body.token;

    const createEndpointResponse = await niceFetch(STACK_SVIX_SERVER_URL + `/api/v1/app/${projectId}/endpoint`, {
      method: "POST",
      body: JSON.stringify({
        url: "https://example.com"
      }),
      headers: {
        "Authorization": `Bearer ${svixToken}`,
        "Content-Type": "application/json",
      },
    });

    return {
      projectId,
      svixToken,
      endpointId: createEndpointResponse.body.id
    };
  }

  export async function listWebhookAttempts(projectId: string, endpointId: string, svixToken: string) {
    const response = await niceFetch(STACK_SVIX_SERVER_URL + `/api/v1/app/${projectId}/attempt/endpoint/${endpointId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${svixToken}`,
        "Content-Type": "application/json",
      },
    });

    const messages = await Promise.all(response.body.data.map(async (attempt: any) => {
      const messageResponse = await niceFetch(STACK_SVIX_SERVER_URL + `/api/v1/app/${projectId}/msg/${attempt.msgId}?with_content=true`, {
        headers: {
          "Authorization": `Bearer ${svixToken}`,
          "Content-Type": "application/json",
        },
        method: "GET",
      });
      return messageResponse.body;
    }));

    return messages.sort((a, b) => {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  }
}
