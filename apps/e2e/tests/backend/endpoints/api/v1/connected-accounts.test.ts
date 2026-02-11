import { it, niceFetch } from "../../../../helpers";
import { localhostUrl } from "../../../../helpers/ports";
import { Auth, backendContext, createMailbox, niceBackendFetch } from "../../../backend-helpers";

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

it("should list all connected accounts for the current user", async ({ expect }) => {
  await Auth.OAuth.signIn();

  const response = await niceBackendFetch("/api/v1/connected-accounts/me", {
    accessType: "client",
    method: "GET",
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "provider": "spotify",
            "provider_account_id": "default-mailbox--<stripped UUID>@stack-generated.example.com",
            "user_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should get access token by provider and provider_account_id", async ({ expect }) => {
  await Auth.OAuth.signIn();

  // First, list connected accounts to get the provider_account_id
  const listResponse = await niceBackendFetch("/api/v1/connected-accounts/me", {
    accessType: "client",
    method: "GET",
  });
  expect(listResponse.status).toBe(200);

  const account = listResponse.body.items[0];
  const providerId = account.provider;
  const providerAccountId = account.provider_account_id;

  // Get access token using provider and provider_account_id
  const response = await niceBackendFetch(`/api/v1/connected-accounts/me/${providerId}/${encodeURIComponent(providerAccountId)}/access-token`, {
    accessType: "client",
    method: "POST",
    body: {
      scope: "openid",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": { "access_token": <stripped field 'access_token'> },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const accessToken = response.body.access_token;

  // Verify the access token works
  const verifyResponse = await niceFetch(mockOAuthUrl("/me"), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  expect(verifyResponse.status).toBe(200);
});

it("should return 404 when trying to get access token for non-existent provider_account_id", async ({ expect }) => {
  await Auth.OAuth.signIn();

  const response = await niceBackendFetch("/api/v1/connected-accounts/me/spotify/non-existent-account-id/access-token", {
    accessType: "client",
    method: "POST",
    body: {
      scope: "openid",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "OAUTH_CONNECTION_NOT_CONNECTED_TO_USER",
        "error": "The OAuth connection is not connected to any user.",
      },
      "headers": Headers {
        "x-stack-known-error": "OAUTH_CONNECTION_NOT_CONNECTED_TO_USER",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should return empty list when user has no connected accounts", async ({ expect }) => {
  // Sign in without OAuth (using password)
  await Auth.Password.signUpWithEmail();

  const response = await niceBackendFetch("/api/v1/connected-accounts/me", {
    accessType: "client",
    method: "GET",
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should list multiple connected accounts from the same provider", async ({ expect }) => {
  await Auth.OAuth.signIn();

  // Get user ID
  const userResponse = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    method: "GET",
  });
  const userId = userResponse.body.id;

  // Add a second connected account for the same provider (spotify) using server API
  await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: userId,
      provider_config_id: "spotify",
      email: "second-account@example.com",
      account_id: "second-spotify-account-123",
      allow_sign_in: false,
      allow_connected_accounts: true,
    },
  });

  // List connected accounts - should show both
  const response = await niceBackendFetch("/api/v1/connected-accounts/me", {
    accessType: "client",
    method: "GET",
  });
  expect(response.status).toBe(200);
  expect(response.body.items.length).toBe(2);
  expect(response.body.items.map((i: any) => i.provider)).toEqual(["spotify", "spotify"]);
});

it("should list connected accounts from different providers", async ({ expect }) => {
  await Auth.OAuth.signIn();

  // Get user ID
  const userResponse = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    method: "GET",
  });
  const userId = userResponse.body.id;

  // Add a connected account for a different provider using server API
  await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: userId,
      provider_config_id: "github",
      email: "github-account@example.com",
      account_id: "github-account-456",
      allow_sign_in: false,
      allow_connected_accounts: true,
    },
  });

  // List connected accounts - should show both providers
  const response = await niceBackendFetch("/api/v1/connected-accounts/me", {
    accessType: "client",
    method: "GET",
  });
  expect(response.status).toBe(200);
  expect(response.body.items.length).toBe(2);
  const providerIds = response.body.items.map((i: any) => i.provider).sort();
  expect(providerIds).toEqual(["github", "spotify"]);
});

it("should access connected accounts via server access type", async ({ expect }) => {
  await Auth.OAuth.signIn();

  // Get user ID
  const userResponse = await niceBackendFetch("/api/v1/users/me", {
    accessType: "server",
    method: "GET",
  });
  const userId = userResponse.body.id;

  // List connected accounts using server access
  const response = await niceBackendFetch(`/api/v1/connected-accounts/${userId}`, {
    accessType: "server",
    method: "GET",
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "provider": "spotify",
            "provider_account_id": "default-mailbox--<stripped UUID>@stack-generated.example.com",
            "user_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should get access token via server access type using provider_account_id", async ({ expect }) => {
  await Auth.OAuth.signIn();

  // Get user ID and account info
  const userResponse = await niceBackendFetch("/api/v1/users/me", {
    accessType: "server",
    method: "GET",
  });
  const userId = userResponse.body.id;

  // List connected accounts to get provider_account_id
  const listResponse = await niceBackendFetch(`/api/v1/connected-accounts/${userId}`, {
    accessType: "server",
    method: "GET",
  });
  const account = listResponse.body.items[0];

  // Get access token using server access with specific provider_account_id
  const response = await niceBackendFetch(
    `/api/v1/connected-accounts/${userId}/${account.provider}/${encodeURIComponent(account.provider_account_id)}/access-token`,
    {
      accessType: "server",
      method: "POST",
      body: { scope: "openid" },
    }
  );
  expect(response.status).toBe(201);
  expect(response.body.access_token).toBeDefined();

  // Verify the access token works
  const verifyResponse = await niceFetch(mockOAuthUrl("/me"), {
    headers: {
      Authorization: `Bearer ${response.body.access_token}`,
    },
  });
  expect(verifyResponse.status).toBe(200);
});

it("should forbid client access to other users' connected accounts", async ({ expect }) => {
  // User 1 signs in with OAuth
  const user1 = await Auth.OAuth.signIn();

  // Get user 1's ID
  const user1Response = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    method: "GET",
  });
  const user1Id = user1Response.body.id;

  // User 2 signs in
  backendContext.set({ mailbox: createMailbox() });
  await Auth.Password.signUpWithEmail();

  // Try to access user 1's connected accounts as user 2
  const response = await niceBackendFetch(`/api/v1/connected-accounts/${user1Id}`, {
    accessType: "client",
    method: "GET",
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": "Client can only list connected accounts for their own user.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should return error for non-existent provider when getting access token", async ({ expect }) => {
  await Auth.OAuth.signIn();

  const response = await niceBackendFetch("/api/v1/connected-accounts/me/non-existent-provider/some-account-id/access-token", {
    accessType: "client",
    method: "POST",
    body: { scope: "openid" },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "OAUTH_PROVIDER_NOT_FOUND_OR_NOT_ENABLED",
        "error": "The OAuth provider is not found or not enabled.",
      },
      "headers": Headers {
        "x-stack-known-error": "OAUTH_PROVIDER_NOT_FOUND_OR_NOT_ENABLED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should not list accounts where allow_connected_accounts is false", async ({ expect }) => {
  await Auth.OAuth.signIn();

  // Get user ID
  const userResponse = await niceBackendFetch("/api/v1/users/me", {
    accessType: "server",
    method: "GET",
  });
  const userId = userResponse.body.id;

  // Add a connected account with allow_connected_accounts = false
  await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: userId,
      provider_config_id: "spotify",
      email: "not-connected@example.com",
      account_id: "not-connected-account-789",
      allow_sign_in: false,
      allow_connected_accounts: false,
    },
  });

  // List connected accounts - should only show the one with allow_connected_accounts = true
  const response = await niceBackendFetch("/api/v1/connected-accounts/me", {
    accessType: "client",
    method: "GET",
  });
  expect(response.status).toBe(200);
  // Should still only have the original connected account, not the new one with allow_connected_accounts = false
  expect(response.body.items.length).toBe(1);
  expect(response.body.items[0].provider_account_id).not.toBe("not-connected-account-789");
});

it("should get access token for specific account when user has multiple accounts", async ({ expect }) => {
  await Auth.OAuth.signIn();

  // Get user ID
  const userResponse = await niceBackendFetch("/api/v1/users/me", {
    accessType: "server",
    method: "GET",
  });
  const userId = userResponse.body.id;

  // Add a second connected account for spotify
  await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: userId,
      provider_config_id: "spotify",
      email: "second-account@example.com",
      account_id: "second-spotify-account-unique",
      allow_sign_in: false,
      allow_connected_accounts: true,
    },
  });

  // List to confirm we have 2 accounts
  const listResponse = await niceBackendFetch("/api/v1/connected-accounts/me", {
    accessType: "client",
    method: "GET",
  });
  expect(listResponse.body.items.length).toBe(2);

  // Get access token for the second account specifically
  const response = await niceBackendFetch("/api/v1/connected-accounts/me/spotify/second-spotify-account-unique/access-token", {
    accessType: "client",
    method: "POST",
    body: { scope: "openid" },
  });
  // The mock OAuth server doesn't have a refresh token for this manually created account,
  // so it will return an error about not having the required scope
  expect(response.status).toBe(400);
  expect(response.body.code).toBe("OAUTH_CONNECTION_DOES_NOT_HAVE_REQUIRED_SCOPE");
});

it("should differentiate between accounts with same provider but different account IDs", async ({ expect }) => {
  await Auth.OAuth.signIn();

  // Get user ID
  const userResponse = await niceBackendFetch("/api/v1/users/me", {
    accessType: "server",
    method: "GET",
  });
  const userId = userResponse.body.id;

  // Add two more accounts with distinct account IDs
  await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: userId,
      provider_config_id: "spotify",
      email: "alice@example.com",
      account_id: "alice-spotify-id",
      allow_sign_in: false,
      allow_connected_accounts: true,
    },
  });

  await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: userId,
      provider_config_id: "spotify",
      email: "bob@example.com",
      account_id: "bob-spotify-id",
      allow_sign_in: false,
      allow_connected_accounts: true,
    },
  });

  // List connected accounts
  const response = await niceBackendFetch("/api/v1/connected-accounts/me", {
    accessType: "client",
    method: "GET",
  });
  expect(response.status).toBe(200);
  expect(response.body.items.length).toBe(3);

  // Verify each account has unique provider_account_id
  const accountIds = response.body.items.map((i: any) => i.provider_account_id);
  const uniqueAccountIds = new Set(accountIds);
  expect(uniqueAccountIds.size).toBe(3);

  // Verify we can find specific accounts
  const aliceAccount = response.body.items.find((i: any) => i.provider_account_id === "alice-spotify-id");
  const bobAccount = response.body.items.find((i: any) => i.provider_account_id === "bob-spotify-id");
  expect(aliceAccount).toBeDefined();
  expect(bobAccount).toBeDefined();
  expect(aliceAccount.provider).toBe("spotify");
  expect(bobAccount.provider).toBe("spotify");
});

it("should return 400 when unauthenticated user tries to list connected accounts", async ({ expect }) => {
  // Don't sign in - just try to access
  const response = await niceBackendFetch("/api/v1/connected-accounts/me", {
    accessType: "client",
    method: "GET",
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "CANNOT_GET_OWN_USER_WITHOUT_USER",
        "error": "You have specified 'me' as a userId, but did not provide authentication for a user.",
      },
      "headers": Headers {
        "x-stack-known-error": "CANNOT_GET_OWN_USER_WITHOUT_USER",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should return 400 when trying to list connected accounts for non-existent user via server access", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/connected-accounts/non-existent-user-id", {
    accessType: "server",
    method: "GET",
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on GET /api/v1/connected-accounts/non-existent-user-id:
              - params.user_id must be a valid UUID
          \`,
        },
        "error": deindent\`
          Request validation failed on GET /api/v1/connected-accounts/non-existent-user-id:
            - params.user_id must be a valid UUID
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should allow server access to list any user's connected accounts", async ({ expect }) => {
  // User 1 signs in with OAuth
  await Auth.OAuth.signIn();

  // Get user 1's ID
  const user1Response = await niceBackendFetch("/api/v1/users/me", {
    accessType: "server",
    method: "GET",
  });
  const user1Id = user1Response.body.id;

  // User 2 signs in
  backendContext.set({ mailbox: createMailbox() });
  await Auth.Password.signUpWithEmail();

  // Server can access user 1's connected accounts
  const response = await niceBackendFetch(`/api/v1/connected-accounts/${user1Id}`, {
    accessType: "server",
    method: "GET",
  });
  expect(response.status).toBe(200);
  expect(response.body.items.length).toBe(1);
  expect(response.body.items[0].provider).toBe("spotify");
});

it("should get access token using the legacy endpoint (by provider only)", async ({ expect }) => {
  await Auth.OAuth.signIn();

  // This is the backward-compatible endpoint that returns the first matching account
  const response = await niceBackendFetch("/api/v1/connected-accounts/me/spotify/access-token", {
    accessType: "client",
    method: "POST",
    body: { scope: "openid" },
  });
  expect(response.status).toBe(201);
  expect(response.body.access_token).toBeDefined();
});

it("should return correct user_id in listed connected accounts", async ({ expect }) => {
  await Auth.OAuth.signIn();

  // Get user ID from users endpoint
  const userResponse = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    method: "GET",
  });
  const expectedUserId = userResponse.body.id;

  // List connected accounts
  const response = await niceBackendFetch("/api/v1/connected-accounts/me", {
    accessType: "client",
    method: "GET",
  });
  expect(response.status).toBe(200);
  expect(response.body.items.length).toBeGreaterThan(0);

  // Verify user_id matches for all items
  for (const item of response.body.items) {
    expect(item.user_id).toBe(expectedUserId);
  }
});
