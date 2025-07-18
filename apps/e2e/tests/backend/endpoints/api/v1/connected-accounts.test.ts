import { it, niceFetch } from "../../../../helpers";
import { Auth, niceBackendFetch } from "../../../backend-helpers";

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

  const response3 = await niceFetch('http://localhost:8114/me', {
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

  const response3 = await niceFetch('http://localhost:8114/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  expect(response3.status).toBe(200);

  // revoke the access token
  const response4 = await niceFetch("http://localhost:8114/revoke-access-token", {
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
  const response5 = await niceFetch('http://localhost:8114/me', {
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
  const response7 = await niceFetch('http://localhost:8114/me', {
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

  const response3 = await niceFetch('http://localhost:8114/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  expect(response3.status).toBe(200);

  // revoke the refresh token
  const response4 = await niceFetch("http://localhost:8114/revoke-refresh-token", {
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
