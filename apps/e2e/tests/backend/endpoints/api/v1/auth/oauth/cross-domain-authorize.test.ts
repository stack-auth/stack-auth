import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { publishableClientKeyNotNecessarySentinel } from "@stackframe/stack-shared/dist/utils/oauth";
import { it, localRedirectUrl } from "../../../../../../helpers";
import { Auth, backendContext, niceBackendFetch } from "../../../../../backend-helpers";

const pkceCodeVerifier = "W2LPAD4M4ES-3wBjzU6J5ApykmuxQy5VTs3oSmtboDM";
const pkceCodeChallenge = "xf6HY7PIgoaCf_eMniSt-45brYE2J_05C9BnfIbueik";

const createCrossDomainAuthorizeRedirect = async (options?: {
  redirectUri?: string,
  afterCallbackRedirectUrl?: string,
  state?: string,
  codeChallenge?: string,
  userAuth?: {
    accessToken?: string,
    refreshToken?: string,
  },
}) => {
  return await niceBackendFetch("/api/v1/auth/oauth/cross-domain/authorize", {
    method: "POST",
    accessType: "client",
    userAuth: options?.userAuth,
    body: {
      redirect_uri: options?.redirectUri ?? `${localRedirectUrl}/handler/oauth-callback?stack_cross_domain_auth=1`,
      state: options?.state ?? "cross-domain-state",
      code_challenge: options?.codeChallenge ?? pkceCodeChallenge,
      code_challenge_method: "S256",
      after_callback_redirect_url: options?.afterCallbackRedirectUrl ?? `${localRedirectUrl}/after-sign-in`,
    },
  });
};

const exchangeAuthorizationCode = async (options: {
  authorizationCode: string,
  redirectUri: string,
  codeVerifier?: string,
}) => {
  const projectKeys = backendContext.value.projectKeys;
  if (projectKeys === "no-project") {
    throw new Error("No project keys found in the backend context");
  }
  return await niceBackendFetch("/api/v1/auth/oauth/token", {
    method: "POST",
    accessType: "client",
    body: {
      client_id: projectKeys.projectId,
      client_secret: projectKeys.publishableClientKey ?? publishableClientKeyNotNecessarySentinel,
      code: options.authorizationCode,
      redirect_uri: options.redirectUri,
      code_verifier: options.codeVerifier ?? pkceCodeVerifier,
      grant_type: "authorization_code",
    },
  });
};

it("creates a one-time cross-domain redirect and exchanges it with PKCE", async ({ expect }) => {
  await Auth.Password.signUpWithEmail({ noWaitForEmail: true });
  const existingRefreshToken = backendContext.value.userAuth?.refreshToken ?? throwErr("Missing refresh token in backend test context");
  const redirectUri = `${localRedirectUrl}/handler/oauth-callback?stack_cross_domain_auth=1`;
  const afterCallbackRedirectUrl = `${localRedirectUrl}/after-sign-in`;

  const authorizeResponse = await createCrossDomainAuthorizeRedirect({
    redirectUri,
    afterCallbackRedirectUrl,
  });
  expect(authorizeResponse.status).toBe(200);
  expect(authorizeResponse.body.redirect_url).toEqual(expect.any(String));
  const redirectUrl = new URL(authorizeResponse.body.redirect_url);
  expect(redirectUrl.origin).toBe(new URL(localRedirectUrl).origin);
  expect(redirectUrl.pathname).toBe(new URL(localRedirectUrl).pathname + "/handler/oauth-callback");
  expect(redirectUrl.searchParams.get("state")).toBe("cross-domain-state");
  const authorizationCode = redirectUrl.searchParams.get("code") ?? throwErr("Authorization code is missing in cross-domain redirect URL");

  const tokenResponse = await exchangeAuthorizationCode({
    authorizationCode,
    redirectUri,
  });
  expect(tokenResponse).toMatchObject({
    status: 200,
    body: {
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      after_callback_redirect_url: afterCallbackRedirectUrl,
      afterCallbackRedirectUrl,
    },
  });
  expect(tokenResponse.body.refresh_token).toBe(existingRefreshToken);
});

it("rejects reusing the same cross-domain authorization code", async ({ expect }) => {
  await Auth.Password.signUpWithEmail({ noWaitForEmail: true });
  const redirectUri = `${localRedirectUrl}/handler/oauth-callback?stack_cross_domain_auth=1`;

  const authorizeResponse = await createCrossDomainAuthorizeRedirect({ redirectUri });
  const authorizationCode = new URL(authorizeResponse.body.redirect_url).searchParams.get("code") ?? throwErr("Authorization code is missing in cross-domain redirect URL");

  const firstExchange = await exchangeAuthorizationCode({ authorizationCode, redirectUri });
  expect(firstExchange.status).toBe(200);

  const secondExchange = await exchangeAuthorizationCode({ authorizationCode, redirectUri });
  expect(secondExchange).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "INVALID_AUTHORIZATION_CODE",
        "error": "The given authorization code is invalid.",
      },
      "headers": Headers {
        "x-stack-known-error": "INVALID_AUTHORIZATION_CODE",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("rejects exchanging with an invalid PKCE code_verifier", async ({ expect }) => {
  await Auth.Password.signUpWithEmail({ noWaitForEmail: true });
  const redirectUri = `${localRedirectUrl}/handler/oauth-callback?stack_cross_domain_auth=1`;

  const authorizeResponse = await createCrossDomainAuthorizeRedirect({ redirectUri });
  const authorizationCode = new URL(authorizeResponse.body.redirect_url).searchParams.get("code") ?? throwErr("Authorization code is missing in cross-domain redirect URL");

  const tokenResponse = await exchangeAuthorizationCode({
    authorizationCode,
    redirectUri,
    codeVerifier: "this-is-an-invalid-pkce-verifier",
  });
  expect(tokenResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "INVALID_AUTHORIZATION_CODE",
        "error": "The given authorization code is invalid.",
      },
      "headers": Headers {
        "x-stack-known-error": "INVALID_AUTHORIZATION_CODE",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("rejects untrusted redirect URLs before issuing a code", async ({ expect }) => {
  await Auth.Password.signUpWithEmail({ noWaitForEmail: true });

  const response = await createCrossDomainAuthorizeRedirect({
    redirectUri: "https://evil.example.com/oauth/callback",
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "REDIRECT_URL_NOT_WHITELISTED",
        "error": "Redirect URL not whitelisted. Did you forget to add this domain to the trusted domains list on the Stack Auth dashboard?",
      },
      "headers": Headers {
        "x-stack-known-error": "REDIRECT_URL_NOT_WHITELISTED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("rejects untrusted after-callback redirect URLs before issuing a code", async ({ expect }) => {
  await Auth.Password.signUpWithEmail({ noWaitForEmail: true });

  const response = await createCrossDomainAuthorizeRedirect({
    afterCallbackRedirectUrl: "https://evil.example.com/post-auth",
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "REDIRECT_URL_NOT_WHITELISTED",
        "error": "Redirect URL not whitelisted. Did you forget to add this domain to the trusted domains list on the Stack Auth dashboard?",
      },
      "headers": Headers {
        "x-stack-known-error": "REDIRECT_URL_NOT_WHITELISTED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("requires a signed-in user to issue a cross-domain code", async ({ expect }) => {
  await Auth.Password.signUpWithEmail({ noWaitForEmail: true });
  backendContext.set({ userAuth: null });

  const response = await createCrossDomainAuthorizeRedirect();
  expect(response.status).toBe(401);
  expect(response.body.code).toBe("USER_AUTHENTICATION_REQUIRED");
});

it("requires providing the current refresh token to issue a cross-domain code", async ({ expect }) => {
  const { signUpResponse } = await Auth.Password.signUpWithEmail({ noWaitForEmail: true });
  backendContext.set({
    userAuth: {
      accessToken: signUpResponse.body.access_token,
      refreshToken: undefined,
    },
  });

  const response = await createCrossDomainAuthorizeRedirect();
  expect(response.status).toBe(400);
  expect(response.body).toBe("Cross-domain auth handoff requires passing the current refresh token.");
});

it("rejects refresh tokens that do not match the authenticated session", async ({ expect }) => {
  const firstSignUp = await Auth.Password.signUpWithEmail({ noWaitForEmail: true });
  const response = await createCrossDomainAuthorizeRedirect({
    userAuth: {
      accessToken: firstSignUp.signUpResponse.body.access_token,
      refreshToken: "this-refresh-token-does-not-match-the-current-session",
    },
  });
  expect(response.status).toBe(401);
  expect(response.body).toBe("Cross-domain auth handoff refresh token does not match the authenticated session.");
});

it("does not authorize when only a refresh token is present", async ({ expect }) => {
  const { signUpResponse } = await Auth.Password.signUpWithEmail({ noWaitForEmail: true });
  backendContext.set({
    userAuth: {
      accessToken: undefined,
      refreshToken: signUpResponse.body.refresh_token,
    },
  });

  const response = await createCrossDomainAuthorizeRedirect();
  expect(response.status).toBe(401);
  expect(response.body.code).toBe("USER_AUTHENTICATION_REQUIRED");
});
