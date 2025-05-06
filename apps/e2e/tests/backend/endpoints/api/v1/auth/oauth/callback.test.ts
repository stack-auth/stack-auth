
import { it, localRedirectUrl, updateCookiesFromResponse } from "../../../../../../helpers";
import { Auth, InternalApiKey, Project, niceBackendFetch } from "../../../../../backend-helpers";

it("should return outer authorization code when inner callback url is valid", async ({ expect }) => {
  const response = await Auth.OAuth.getAuthorizationCode();
  expect(response.authorizationCode).toBeTruthy();
});

it("should return outer authorization code when inner callback url is valid, even if invalid error redirect url is passed", async ({ expect }) => {
  const authorize = await Auth.OAuth.authorize({ errorRedirectUrl: "http://error-redirect-url.stack-test.example.com" });
  const getInnerCallbackUrlResponse = await Auth.OAuth.getInnerCallbackUrl(authorize);
  const response = await Auth.OAuth.getAuthorizationCode(getInnerCallbackUrlResponse);
  expect(response.authorizationCode).toBeTruthy();
});

it("should fail when inner callback has invalid provider ID", async ({ expect }) => {
  const getInnerCallbackUrlResponse = await Auth.OAuth.getInnerCallbackUrl();
  const innerCallbackUrl = new URL(getInnerCallbackUrlResponse.innerCallbackUrl);
  innerCallbackUrl.pathname = "/api/v1/auth/oauth/callback/microsoft";
  const cookie = updateCookiesFromResponse("", getInnerCallbackUrlResponse.authorizeResponse);
  const response = await niceBackendFetch(innerCallbackUrl, {
    redirect: "manual",
    headers: {
      cookie,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Inner OAuth callback failed due to invalid grant. Please try again.",
      "headers": Headers {
        "set-cookie": <deleting cookie 'stack-oauth-inner-<stripped cookie name key>' at path '/'>,
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should fail when account is new and sign ups are disabled", async ({ expect }) => {
  await Project.createAndSwitch({ config: { sign_up_enabled: false, oauth_providers: [ { id: "spotify", type: "shared" } ] } });
  await InternalApiKey.createAndSetProjectKeys();
  const getInnerCallbackUrlResponse = await Auth.OAuth.getInnerCallbackUrl();
  const cookie = updateCookiesFromResponse("", getInnerCallbackUrlResponse.authorizeResponse);
  const response = await niceBackendFetch(getInnerCallbackUrlResponse.innerCallbackUrl, {
    redirect: "manual",
    headers: {
      cookie,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SIGN_UP_NOT_ENABLED",
        "error": "Creation of new accounts is not enabled for this project. Please ask the project owner to enable it.",
      },
      "headers": Headers {
        "set-cookie": <deleting cookie 'stack-oauth-inner-<stripped cookie name key>' at path '/'>,
        "x-stack-known-error": "SIGN_UP_NOT_ENABLED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should fail when cookies are missing", async ({ expect }) => {
  const getInnerCallbackUrlResponse = await Auth.OAuth.getInnerCallbackUrl();
  const response = await niceBackendFetch(getInnerCallbackUrlResponse.innerCallbackUrl, {
    redirect: "manual",
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Inner OAuth cookie not found. This is likely because you refreshed the page during the OAuth sign in process. Please try signing in again",
      "headers": Headers {
        "set-cookie": <deleting cookie 'stack-oauth-inner-<stripped cookie name key>' at path '/'>,
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should fail when inner callback has invalid authorization code", async ({ expect }) => {
  const getInnerCallbackUrlResponse = await Auth.OAuth.getInnerCallbackUrl();
  const innerCallbackUrl = new URL(getInnerCallbackUrlResponse.innerCallbackUrl);
  innerCallbackUrl.searchParams.set("code", "invalid-authorization-code");
  const cookie = updateCookiesFromResponse("", getInnerCallbackUrlResponse.authorizeResponse);
  const response = await niceBackendFetch(innerCallbackUrl, {
    redirect: "manual",
    headers: {
      cookie,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Inner OAuth callback failed due to invalid grant. Please try again.",
      "headers": Headers {
        "set-cookie": <deleting cookie 'stack-oauth-inner-<stripped cookie name key>' at path '/'>,
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should redirect to error callback url when inner callback has invalid authorization code", async ({ expect }) => {
  const authorize = await Auth.OAuth.authorize({ errorRedirectUrl: localRedirectUrl + "/callback-error" });
  const getInnerCallbackUrlResponse = await Auth.OAuth.getInnerCallbackUrl(authorize);
  const innerCallbackUrl = new URL(getInnerCallbackUrlResponse.innerCallbackUrl);
  innerCallbackUrl.searchParams.set("code", "invalid-authorization-code");
  const cookie = updateCookiesFromResponse("", getInnerCallbackUrlResponse.authorizeResponse);
  const response = await niceBackendFetch(innerCallbackUrl, {
    redirect: "manual",
    headers: {
      cookie,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Inner OAuth callback failed due to invalid grant. Please try again.",
      "headers": Headers {
        "set-cookie": <deleting cookie 'stack-oauth-inner-<stripped cookie name key>' at path '/'>,
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should fail when inner callback has invalid authorization code and when an invalid error redirect url is passed", async ({ expect }) => {
  const authorize = await Auth.OAuth.authorize({ errorRedirectUrl: "http://error-redirect-url.stack-test.example.com" });
  const getInnerCallbackUrlResponse = await Auth.OAuth.getInnerCallbackUrl(authorize);
  const innerCallbackUrl = new URL(getInnerCallbackUrlResponse.innerCallbackUrl);
  innerCallbackUrl.searchParams.set("code", "invalid-authorization-code");
  const cookie = updateCookiesFromResponse("", getInnerCallbackUrlResponse.authorizeResponse);
  const response = await niceBackendFetch(innerCallbackUrl, {
    redirect: "manual",
    headers: {
      cookie,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Inner OAuth callback failed due to invalid grant. Please try again.",
      "headers": Headers {
        "set-cookie": <deleting cookie 'stack-oauth-inner-<stripped cookie name key>' at path '/'>,
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should fail when inner callback has invalid state", async ({ expect }) => {
  const getInnerCallbackUrlResponse = await Auth.OAuth.getInnerCallbackUrl();
  const innerCallbackUrl = new URL(getInnerCallbackUrlResponse.innerCallbackUrl);
  innerCallbackUrl.searchParams.set("state", "invalid-state");
  const cookie = updateCookiesFromResponse("", getInnerCallbackUrlResponse.authorizeResponse);
  const response = await niceBackendFetch(innerCallbackUrl, {
    redirect: "manual",
    headers: {
      cookie,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Inner OAuth cookie not found. This is likely because you refreshed the page during the OAuth sign in process. Please try signing in again",
      "headers": Headers {
        "set-cookie": <deleting cookie 'stack-oauth-inner-<stripped cookie name key>' at path '/'>,
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should fail if an untrusted redirect URL is provided", async ({ expect }) => {
  const authorize = await Auth.OAuth.authorize({ redirectUrl: "http://untrusted-redirect-url.stack-test.example.com" });
  const getInnerCallbackUrlResponse = await Auth.OAuth.getInnerCallbackUrl(authorize);
  const cookie = updateCookiesFromResponse("", getInnerCallbackUrlResponse.authorizeResponse);
  const response = await niceBackendFetch(getInnerCallbackUrlResponse.innerCallbackUrl, {
    redirect: "manual",
    headers: {
      cookie,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "REDIRECT_URL_NOT_WHITELISTED",
        "error": "Redirect URL not whitelisted. Did you forget to add this domain to the trusted domains list on the Stack Auth dashboard?",
      },
      "headers": Headers {
        "set-cookie": <deleting cookie 'stack-oauth-inner-<stripped cookie name key>' at path '/'>,
        "x-stack-known-error": "REDIRECT_URL_NOT_WHITELISTED",
        <some fields may have been hidden>,
      },
    }
  `);
});
