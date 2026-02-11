import { it, niceFetch } from "../../../../helpers";
import { localhostUrl } from "../../../../helpers/ports";
import { Auth, niceBackendFetch } from "../../../backend-helpers";

const mockOAuthUrl = (path: string) => localhostUrl("14", path);

it("should use the connected account access token to access the userinfo endpoint of the oauth provider", async ({ expect }) => {
  await Auth.OAuth.signIn();

  const response2 = await niceBackendFetch("/api/v1/connected-accounts/me/spotify/access-token", {
    accessType: "client",
    method: "POST",
    body: {
      scope: "openid",
    },
  });
  expect(response2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": { "access_token": <stripped field 'access_token'> },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const accessToken = response2.body.access_token;

  const response3 = await niceFetch(mockOAuthUrl("/me"), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  expect(response3).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "sub": "default-mailbox--<stripped UUID>@stack-generated.example.com" },
      "headers": Headers {
        "x-powered-by": "Express",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should refresh the connected account access token when it is revoked from the oauth provider", async ({ expect }) => {
  await Auth.OAuth.signIn();

  const response2 = await niceBackendFetch("/api/v1/connected-accounts/me/spotify/access-token", {
    accessType: "client",
    method: "POST",
    body: {
      scope: "openid",
    },
  });
  expect(response2.status).toBe(201);

  const accessToken = response2.body.access_token;

  const response3 = await niceFetch(mockOAuthUrl("/me"), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  expect(response3.status).toBe(200);

  // revoke the access token
  const response4 = await niceFetch(mockOAuthUrl("/revoke-access-token"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: accessToken,
    }),
  });
  expect(response4).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "message": "Access token has been revoked",
        "success": true,
      },
      "headers": Headers {
        "x-powered-by": "Express",
        <some fields may have been hidden>,
      },
    }
  `);

  // try to use the access token again, should fail
  const response5 = await niceFetch(mockOAuthUrl("/me"), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  expect(response5.status).toBe(401);

  // try to get the access token again
  const response6 = await niceBackendFetch("/api/v1/connected-accounts/me/spotify/access-token", {
    accessType: "client",
    method: "POST",
    body: {
      scope: "openid",
    },
  });
  expect(response6.status).toBe(201);

  // use the new access token to fetch the userinfo endpoint
  const response7 = await niceFetch(mockOAuthUrl("/me"), {
    headers: {
      Authorization: `Bearer ${response6.body.access_token}`,
    },
  });
  expect(response7).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "sub": "default-mailbox--<stripped UUID>@stack-generated.example.com" },
      "headers": Headers {
        "x-powered-by": "Express",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should prompt the user to re-authorize the connected account when the refresh token is revoked from the oauth provider", async ({ expect }) => {
  await Auth.OAuth.signIn();

  const response2 = await niceBackendFetch("/api/v1/connected-accounts/me/spotify/access-token", {
    accessType: "client",
    method: "POST",
    body: {
      scope: "openid",
    },
  });
  expect(response2.status).toBe(201);

  const accessToken = response2.body.access_token;

  const response3 = await niceFetch(mockOAuthUrl("/me"), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  expect(response3.status).toBe(200);

  // revoke the refresh token
  const response4 = await niceFetch(mockOAuthUrl("/revoke-refresh-token"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: accessToken,
    }),
  });
  expect(response4).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "message": "Grant and associated refresh tokens have been revoked",
        "success": true,
      },
      "headers": Headers {
        "x-powered-by": "Express",
        <some fields may have been hidden>,
      },
    }
  `);

  // try to get the access token again
  const response5 = await niceBackendFetch("/api/v1/connected-accounts/me/spotify/access-token", {
    accessType: "client",
    method: "POST",
    body: {
      scope: "openid",
    },
  });
  expect(response5).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "OAUTH_CONNECTION_DOES_NOT_HAVE_REQUIRED_SCOPE",
        "error": "The OAuth connection does not have the required scope.",
      },
      "headers": Headers {
        "x-stack-known-error": "OAUTH_CONNECTION_DOES_NOT_HAVE_REQUIRED_SCOPE",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should handle access_denied error gracefully when refreshing token", async ({ expect }) => {
  await Auth.OAuth.signIn();

  const response2 = await niceBackendFetch("/api/v1/connected-accounts/me/spotify/access-token", {
    accessType: "client",
    method: "POST",
    body: {
      scope: "openid",
    },
  });
  expect(response2.status).toBe(201);

  const accessToken = response2.body.access_token;

  // Simulate access_denied error on next refresh attempt
  const setupError = await niceFetch(mockOAuthUrl("/simulate-refresh-error"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: accessToken,
      error_type: "access_denied",
    }),
  });
  expect(setupError.status).toBe(200);

  // Revoke the access token to force a refresh
  await niceFetch(mockOAuthUrl("/revoke-access-token"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: accessToken,
    }),
  });

  // Try to get a new access token - should fail gracefully with OAUTH_CONNECTION_DOES_NOT_HAVE_REQUIRED_SCOPE
  const response3 = await niceBackendFetch("/api/v1/connected-accounts/me/spotify/access-token", {
    accessType: "client",
    method: "POST",
    body: {
      scope: "openid",
    },
  });
  expect(response3).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "OAUTH_CONNECTION_DOES_NOT_HAVE_REQUIRED_SCOPE",
        "error": "The OAuth connection does not have the required scope.",
      },
      "headers": Headers {
        "x-stack-known-error": "OAUTH_CONNECTION_DOES_NOT_HAVE_REQUIRED_SCOPE",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should handle consent_required error gracefully when refreshing token", async ({ expect }) => {
  await Auth.OAuth.signIn();

  const response2 = await niceBackendFetch("/api/v1/connected-accounts/me/spotify/access-token", {
    accessType: "client",
    method: "POST",
    body: {
      scope: "openid",
    },
  });
  expect(response2.status).toBe(201);

  const accessToken = response2.body.access_token;

  // Simulate consent_required error on next refresh attempt
  const setupError = await niceFetch(mockOAuthUrl("/simulate-refresh-error"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: accessToken,
      error_type: "consent_required",
    }),
  });
  expect(setupError.status).toBe(200);

  // Revoke the access token to force a refresh
  await niceFetch(mockOAuthUrl("/revoke-access-token"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: accessToken,
    }),
  });

  // Try to get a new access token - should fail gracefully
  const response3 = await niceBackendFetch("/api/v1/connected-accounts/me/spotify/access-token", {
    accessType: "client",
    method: "POST",
    body: {
      scope: "openid",
    },
  });
  expect(response3).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "OAUTH_CONNECTION_DOES_NOT_HAVE_REQUIRED_SCOPE",
        "error": "The OAuth connection does not have the required scope.",
      },
      "headers": Headers {
        "x-stack-known-error": "OAUTH_CONNECTION_DOES_NOT_HAVE_REQUIRED_SCOPE",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should handle invalid_token error gracefully when refreshing token", async ({ expect }) => {
  await Auth.OAuth.signIn();

  const response2 = await niceBackendFetch("/api/v1/connected-accounts/me/spotify/access-token", {
    accessType: "client",
    method: "POST",
    body: {
      scope: "openid",
    },
  });
  expect(response2.status).toBe(201);

  const accessToken = response2.body.access_token;

  // Simulate invalid_token error on next refresh attempt
  const setupError = await niceFetch(mockOAuthUrl("/simulate-refresh-error"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: accessToken,
      error_type: "invalid_token",
    }),
  });
  expect(setupError.status).toBe(200);

  // Revoke the access token to force a refresh
  await niceFetch(mockOAuthUrl("/revoke-access-token"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: accessToken,
    }),
  });

  // Try to get a new access token - should fail gracefully
  const response3 = await niceBackendFetch("/api/v1/connected-accounts/me/spotify/access-token", {
    accessType: "client",
    method: "POST",
    body: {
      scope: "openid",
    },
  });
  expect(response3).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "OAUTH_CONNECTION_DOES_NOT_HAVE_REQUIRED_SCOPE",
        "error": "The OAuth connection does not have the required scope.",
      },
      "headers": Headers {
        "x-stack-known-error": "OAUTH_CONNECTION_DOES_NOT_HAVE_REQUIRED_SCOPE",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should handle unauthorized_client error gracefully when refreshing token", async ({ expect }) => {
  await Auth.OAuth.signIn();

  const response2 = await niceBackendFetch("/api/v1/connected-accounts/me/spotify/access-token", {
    accessType: "client",
    method: "POST",
    body: {
      scope: "openid",
    },
  });
  expect(response2.status).toBe(201);

  const accessToken = response2.body.access_token;

  // Simulate unauthorized_client error on next refresh attempt
  const setupError = await niceFetch(mockOAuthUrl("/simulate-refresh-error"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: accessToken,
      error_type: "unauthorized_client",
    }),
  });
  expect(setupError.status).toBe(200);

  // Revoke the access token to force a refresh
  await niceFetch(mockOAuthUrl("/revoke-access-token"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: accessToken,
    }),
  });

  // Try to get a new access token - should fail gracefully
  const response3 = await niceBackendFetch("/api/v1/connected-accounts/me/spotify/access-token", {
    accessType: "client",
    method: "POST",
    body: {
      scope: "openid",
    },
  });
  expect(response3).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "OAUTH_CONNECTION_DOES_NOT_HAVE_REQUIRED_SCOPE",
        "error": "The OAuth connection does not have the required scope.",
      },
      "headers": Headers {
        "x-stack-known-error": "OAUTH_CONNECTION_DOES_NOT_HAVE_REQUIRED_SCOPE",
        <some fields may have been hidden>,
      },
    }
  `);
});
