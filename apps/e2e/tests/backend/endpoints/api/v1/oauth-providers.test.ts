import { it } from "../../../../helpers";
import { Auth, Project, backendContext, createMailbox, niceBackendFetch } from "../../../backend-helpers";

async function createAndSwitchToOAuthEnabledProject() {
  return await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
      oauth_providers: [
        {
          id: "spotify",
          type: "standard",
          client_id: "test_client_id",
          client_secret: "test_client_secret",
        }
      ]
    }
  });
}

it("should create an OAuth provider connection", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_config_id === "spotify");
  expect(providerConfig).toBeDefined();

  const createResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_config_id: providerConfig.id,
      account_id: "test_spotify_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "account_id": "test_spotify_user_123",
        "allow_connected_accounts": true,
        "allow_sign_in": true,
        "email": "test@example.com",
        "id": "<stripped UUID>",
        "type": "spotify",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should read an OAuth provider connection", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_config_id === "spotify");
  expect(providerConfig).toBeDefined();

  const createResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_config_id: providerConfig.id,
      account_id: "test_spotify_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse.status).toBe(201);

  const readResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${createResponse.body.id}`, {
    method: "GET",
    accessType: "client",
  });

  expect(readResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "allow_connected_accounts": true,
        "allow_sign_in": true,
        "email": "test@example.com",
        "id": "<stripped UUID>",
        "type": "spotify",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should list all OAuth provider connections for a user", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_config_id === "spotify");
  expect(providerConfig).toBeDefined();

  const createResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_config_id: providerConfig.id,
      account_id: "test_spotify_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse.status).toBe(201);

  // List all providers
  const listResponse = await niceBackendFetch("/api/v1/oauth-providers?user_id=me", {
    method: "GET",
    accessType: "client",
  });

  expect(listResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "allow_connected_accounts": true,
            "allow_sign_in": true,
            "email": "test@example.com",
            "id": "<stripped UUID>",
            "type": "spotify",
            "user_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should update an OAuth provider connection on the client", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_config_id === "spotify");
  expect(providerConfig).toBeDefined();

  const createResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_config_id: providerConfig.id,
      account_id: "test_spotify_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse.status).toBe(201);

  // Update the provider connection
  const updateResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${createResponse.body.id}`, {
    method: "PATCH",
    accessType: "client",
    body: {
      allow_sign_in: true,
      allow_connected_accounts: false,
    },
  });

  expect(updateResponse.body.allow_connected_accounts).toBe(false);
  expect(updateResponse.body.allow_sign_in).toBe(true);

  // Read again to double check
  const readResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${createResponse.body.id}`, {
    method: "GET",
    accessType: "client",
  });

  expect(readResponse.body.allow_connected_accounts).toBe(false);
  expect(readResponse.body.allow_sign_in).toBe(true);
});

it("should update an OAuth provider connection on the server", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_config_id === "spotify");
  expect(providerConfig).toBeDefined();

  const createResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_config_id: providerConfig.id,
      account_id: "test_spotify_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse.status).toBe(201);

  // Update the provider connection
  const updateResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${createResponse.body.id}`, {
    method: "PATCH",
    accessType: "server",
    body: {
      allow_sign_in: true,
      allow_connected_accounts: true,
      email: "updated@example.com",
    },
  });

  expect(updateResponse.body.allow_connected_accounts).toBe(true);
  expect(updateResponse.body.allow_sign_in).toBe(true);
  expect(updateResponse.body.email).toBe("updated@example.com");

  // Read again to double check
  const readResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${createResponse.body.id}`, {
    method: "GET",
    accessType: "server",
  });

  expect(readResponse.body.allow_connected_accounts).toBe(true);
  expect(readResponse.body.allow_sign_in).toBe(true);
  expect(readResponse.body.email).toBe("updated@example.com");
});

it("should delete an OAuth provider connection", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_config_id === "spotify");
  expect(providerConfig).toBeDefined();

  const createResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_config_id: providerConfig.id,
      account_id: "test_spotify_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse.status).toBe(201);

  // Delete the provider connection
  const deleteResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${createResponse.body.id}`, {
    method: "DELETE",
    accessType: "client",
  });

  expect(deleteResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Verify it's deleted by trying to read it
  const readAfterDeleteResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${createResponse.body.id}`, {
    method: "GET",
    accessType: "client",
  });

  expect(readAfterDeleteResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": "OAuth provider <stripped UUID> for user <stripped UUID> not found",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should return 404 when reading non-existent OAuth provider", async ({ expect }: { expect: any }) => {
  await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const readResponse = await niceBackendFetch("/api/v1/oauth-providers/me/e889e6de-8da5-47fd-87fd-a8db34b14ec4", {
    method: "GET",
    accessType: "client",
  });

  expect(readResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": "OAuth provider <stripped UUID> for user <stripped UUID> not found",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should return 404 when updating non-existent OAuth provider", async ({ expect }: { expect: any }) => {
  await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const updateResponse = await niceBackendFetch("/api/v1/oauth-providers/me/e889e6de-8da5-47fd-87fd-a8db34b14ec4", {
    method: "PATCH",
    accessType: "client",
    body: {
      allow_sign_in: true,
    },
  });

  expect(updateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": "OAuth provider <stripped UUID> for user <stripped UUID> not found",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should return 404 when deleting non-existent OAuth provider", async ({ expect }: { expect: any }) => {
  await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const deleteResponse = await niceBackendFetch("/api/v1/oauth-providers/me/e889e6de-8da5-47fd-87fd-a8db34b14ec4", {
    method: "DELETE",
    accessType: "client",
  });

  expect(deleteResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": "OAuth provider <stripped UUID> for user <stripped UUID> not found",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should forbid client access to other users' OAuth providers", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  const user1 = await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_config_id === "spotify");
  expect(providerConfig).toBeDefined();

  await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_config_id: providerConfig.id,
      account_id: "test_spotify_user_1",
      email: "test1@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  backendContext.set({ mailbox: createMailbox() });
  const user2 = await Auth.Otp.signIn();

  const createResponse2 = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_config_id: providerConfig.id,
      account_id: "test_spotify_user_2",
      email: "test2@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse2.status).toBe(201);

  // Try to read user2's OAuth provider as user2
  const readResponseSelf = await niceBackendFetch(`/api/v1/oauth-providers/${user2.userId}/${createResponse2.body.id}`, {
    method: "GET",
    accessType: "client",
  });

  expect(readResponseSelf).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "allow_connected_accounts": true,
        "allow_sign_in": true,
        "email": "test2@example.com",
        "id": "<stripped UUID>",
        "type": "spotify",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Try to access user1's OAuth provider as user2
  const readResponse = await niceBackendFetch(`/api/v1/oauth-providers/${user1.userId}/${createResponse2.body.id}`, {
    method: "GET",
    accessType: "client",
  });

  expect(readResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": "Client can only read OAuth providers for their own user.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Try to list user1's OAuth providers as user2
  const listResponse = await niceBackendFetch(`/api/v1/oauth-providers?user_id=${user1.userId}`, {
    method: "GET",
    accessType: "client",
  });

  expect(listResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": "Client can only list OAuth providers for their own user.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Try to update user1's OAuth provider as user2
  const updateResponse = await niceBackendFetch(`/api/v1/oauth-providers/${user1.userId}/${createResponse2.body.id}`, {
    method: "PATCH",
    accessType: "client",
    body: {
      allow_sign_in: false,
    },
  });

  expect(updateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": "Client can only update OAuth providers for their own user.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Try to delete user1's OAuth provider as user2
  const deleteResponse = await niceBackendFetch(`/api/v1/oauth-providers/${user1.userId}/${createResponse2.body.id}`, {
    method: "DELETE",
    accessType: "client",
  });

  expect(deleteResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": "Client can only delete OAuth providers for their own user.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should allow server access to any user's OAuth providers", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  const user1 = await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_config_id === "spotify");
  expect(providerConfig).toBeDefined();

  const createResponse1 = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_config_id: providerConfig.id,
      account_id: "test_spotify_user_1",
      email: "test1@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse1.status).toBe(201);

  backendContext.set({ mailbox: createMailbox() });
  const user2 = await Auth.Otp.signIn();

  const createResponse2 = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_config_id: providerConfig.id,
      account_id: "test_spotify_user_2",
      email: "test2@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse2.status).toBe(201);

  // Server should be able to read user1's OAuth provider from user2's context
  const readResponse = await niceBackendFetch(`/api/v1/oauth-providers`, {
    method: "GET",
    accessType: "server",
  });

  expect(readResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "account_id": "test_spotify_user_1",
            "allow_connected_accounts": true,
            "allow_sign_in": true,
            "email": "test1@example.com",
            "id": "<stripped UUID>",
            "type": "spotify",
            "user_id": "<stripped UUID>",
          },
          {
            "account_id": "test_spotify_user_2",
            "allow_connected_accounts": true,
            "allow_sign_in": true,
            "email": "test2@example.com",
            "id": "<stripped UUID>",
            "type": "spotify",
            "user_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Server should be able to list user1's OAuth providers from user2's context
  const listResponse = await niceBackendFetch(`/api/v1/oauth-providers?user_id=${user1.userId}`, {
    method: "GET",
    accessType: "server",
  });

  expect(listResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "account_id": "test_spotify_user_1",
            "allow_connected_accounts": true,
            "allow_sign_in": true,
            "email": "test1@example.com",
            "id": "<stripped UUID>",
            "type": "spotify",
            "user_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Server should be able to update user1's OAuth provider from user2's context
  const updateResponse = await niceBackendFetch(`/api/v1/oauth-providers/${user1.userId}/${createResponse1.body.id}`, {
    method: "PATCH",
    accessType: "server",
    body: {
      allow_sign_in: false,
    },
  });

  expect(updateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "account_id": "test_spotify_user_1",
        "allow_connected_accounts": true,
        "allow_sign_in": false,
        "email": "test1@example.com",
        "id": "<stripped UUID>",
        "type": "spotify",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Server should be able to delete user1's OAuth provider from user2's context
  const deleteResponse = await niceBackendFetch(`/api/v1/oauth-providers/${user1.userId}/${createResponse2.body.id}`, {
    method: "DELETE",
    accessType: "server",
  });

  expect(deleteResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": "OAuth provider <stripped UUID> for user <stripped UUID> not found",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should handle account_id updates correctly", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_config_id === "spotify");
  expect(providerConfig).toBeDefined();

  const createResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_config_id: providerConfig.id,
      account_id: "test_spotify_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse.status).toBe(201);

  // Update the account_id
  const updateResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${createResponse.body.id}`, {
    method: "PATCH",
    accessType: "server",
    body: {
      account_id: "updated_spotify_user_456",
    },
  });

  expect(updateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "account_id": "updated_spotify_user_456",
        "allow_connected_accounts": true,
        "allow_sign_in": true,
        "email": "test@example.com",
        "id": "<stripped UUID>",
        "type": "spotify",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Verify the account_id was updated by reading it back
  const readResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${createResponse.body.id}`, {
    method: "GET",
    accessType: "server",
  });

  expect(readResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "account_id": "updated_spotify_user_456",
        "allow_connected_accounts": true,
        "allow_sign_in": true,
        "email": "test@example.com",
        "id": "<stripped UUID>",
        "type": "spotify",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should return empty list when user has no OAuth providers", async ({ expect }: { expect: any }) => {
  await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  // List providers for a user who has none
  const listResponse = await niceBackendFetch("/api/v1/oauth-providers?user_id=me", {
    method: "GET",
    accessType: "client",
  });

  expect(listResponse).toMatchInlineSnapshot(`
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

it("should handle provider not configured error", async ({ expect }: { expect: any }) => {
  // Create a project with OAuth disabled or without the provider we're trying to use
  const { createProjectResponse } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
      oauth_providers: [] // No OAuth providers configured
    }
  });
  await Auth.Otp.signIn();

  // Try to create an OAuth provider connection with an unconfigured provider
  const createResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_config_id: "spotify", // This provider is not configured in the project
      account_id: "test_spotify_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": "OAuth provider spotify not found or not configured",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should toggle sign-in and connected accounts capabilities", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_config_id === "spotify");
  expect(providerConfig).toBeDefined();

  const createResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_config_id: providerConfig.id,
      account_id: "test_spotify_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse.status).toBe(201);

  // Toggle off both capabilities
  const toggleOffResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${createResponse.body.id}`, {
    method: "PATCH",
    accessType: "client",
    body: {
      allow_sign_in: false,
      allow_connected_accounts: false,
    },
  });

  expect(toggleOffResponse.status).toBe(200);
  expect(toggleOffResponse.body.allow_sign_in).toBe(false);
  expect(toggleOffResponse.body.allow_connected_accounts).toBe(false);

  // Toggle on sign-in, keep connected accounts off
  const toggleSignInResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${createResponse.body.id}`, {
    method: "PATCH",
    accessType: "client",
    body: {
      allow_sign_in: true,
      allow_connected_accounts: false,
    },
  });

  expect(toggleSignInResponse.status).toBe(200);
  expect(toggleSignInResponse.body.allow_sign_in).toBe(true);
  expect(toggleSignInResponse.body.allow_connected_accounts).toBe(false);

  // Toggle on connected accounts, keep sign-in on
  const toggleConnectedAccountsResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${createResponse.body.id}`, {
    method: "PATCH",
    accessType: "client",
    body: {
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(toggleConnectedAccountsResponse.status).toBe(200);
  expect(toggleConnectedAccountsResponse.body.allow_sign_in).toBe(true);
  expect(toggleConnectedAccountsResponse.body.allow_connected_accounts).toBe(true);
});

it("should prevent multiple providers of the same type from being enabled for signing in", async ({ expect }: { expect: any }) => {
  // Test with multiple spotify accounts (same provider type, different account IDs)
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_config_id === "spotify");
  expect(providerConfig).toBeDefined();

  // Create first spotify account connection with sign-in enabled
  const createResponse1 = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_config_id: providerConfig.id,
      account_id: "spotify_user_123",
      email: "user123@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse1.status).toBe(201);

  // Try to create second spotify account connection with sign-in enabled - should fail
  const createResponse2 = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_config_id: providerConfig.id,
      account_id: "spotify_user_456",
      email: "user456@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "The same provider type with sign-in enabled already exists for this user.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Create second spotify account connection with sign-in disabled - should succeed
  const createResponse3 = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_config_id: providerConfig.id,
      account_id: "spotify_user_789",
      email: "user456@example.com",
      allow_sign_in: false,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse3).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "account_id": "spotify_user_789",
        "allow_connected_accounts": true,
        "allow_sign_in": false,
        "email": "user456@example.com",
        "id": "<stripped UUID>",
        "type": "spotify",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Try to enable sign-in on the second account via update - should fail
  const updateResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${createResponse3.body.id}`, {
    method: "PATCH",
    accessType: "server",
    body: {
      allow_sign_in: true,
    },
  });

  expect(updateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "The same provider type with sign-in enabled already exists for this user.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Disable sign-in on the first account
  const disableResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${createResponse1.body.id}`, {
    method: "PATCH",
    accessType: "server",
    body: {
      allow_sign_in: false,
    },
  });

  expect(disableResponse.status).toBe(200);
  expect(disableResponse.body.allow_sign_in).toBe(false);

  // Now enabling sign-in on the second account should succeed
  const enableResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${createResponse3.body.id}`, {
    method: "PATCH",
    accessType: "server",
    body: {
      allow_sign_in: true,
    },
  });

  expect(enableResponse.status).toBe(200);
  expect(enableResponse.body.allow_sign_in).toBe(true);
});

it("should not allow get, update, delete oauth providers with wrong user id and provider id pair", async ({ expect }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();

  // Create user1 and their OAuth provider
  const user1 = await Auth.Otp.signIn();
  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_config_id === "spotify");
  expect(providerConfig).toBeDefined();

  const createResponse1 = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_config_id: providerConfig.id,
      account_id: "test_spotify_user_1",
      email: "test1@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse1.status).toBe(201);
  const provider1Id = createResponse1.body.id;

  backendContext.set({ mailbox: createMailbox() });
  const user2 = await Auth.Otp.signIn();

  const createResponse2 = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_config_id: providerConfig.id,
      account_id: "test_spotify_user_2",
      email: "test2@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse2.status).toBe(201);
  const provider2Id = createResponse2.body.id;

  // Test 1: should be able to access provider1 with user1 id (should succeed)
  const user1ReadProvider1 = await niceBackendFetch(`/api/v1/oauth-providers/${user1.userId}/${provider1Id}`, {
    method: "GET",
    accessType: "server",
  });
  expect(user1ReadProvider1.status).toBe(200);

  // Test 2: should be able to access provider2 with user2 id (should succeed)
  const user2ReadProvider2 = await niceBackendFetch(`/api/v1/oauth-providers/${user2.userId}/${provider2Id}`, {
    method: "GET",
    accessType: "server",
  });
  expect(user2ReadProvider2.status).toBe(200);

  // Test 3: should NOT be able to access provider2 with user1 id (should fail)
  const user1ReadProvider2 = await niceBackendFetch(`/api/v1/oauth-providers/${user1.userId}/${provider2Id}`, {
    method: "GET",
    accessType: "server",
  });
  expect(user1ReadProvider2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": "OAuth provider <stripped UUID> for user <stripped UUID> not found",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Try to UPDATE user2's provider as user1 - should fail
  const user1UpdateProvider2 = await niceBackendFetch(`/api/v1/oauth-providers/${user1.userId}/${provider2Id}`, {
    method: "PATCH",
    accessType: "server",
    body: {
      allow_sign_in: false,
    },
  });
  expect(user1UpdateProvider2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": "OAuth provider <stripped UUID> for user <stripped UUID> not found",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Try to DELETE user2's provider as user1 - should fail
  const user1DeleteProvider2 = await niceBackendFetch(`/api/v1/oauth-providers/${user1.userId}/${provider2Id}`, {
    method: "DELETE",
    accessType: "server",
  });
  expect(user1DeleteProvider2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": "OAuth provider <stripped UUID> for user <stripped UUID> not found",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
