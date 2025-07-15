import { it } from "../../../../helpers";
import { Auth, Project, backendContext, createMailbox, niceBackendFetch } from "../../../backend-helpers";

async function createAndSwitchToOAuthEnabledProject() {
  return await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
      oauth_providers: [
        {
          id: "github",
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

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_id === "github");
  expect(providerConfig).toBeDefined();

  const createResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "test_github_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "account_id": "test_github_user_123",
        "allow_connected_accounts": true,
        "allow_sign_in": true,
        "email": "test@example.com",
        "id": "github",
        "type": "github",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should read an OAuth provider connection", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_id === "github");
  expect(providerConfig).toBeDefined();

  const createResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "test_github_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

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
        "id": "github",
        "type": "github",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should list all OAuth provider connections for a user", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_id === "github");
  expect(providerConfig).toBeDefined();

  const createResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "test_github_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

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
            "id": "github",
            "type": "github",
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

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_id === "github");
  expect(providerConfig).toBeDefined();

  const createResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "test_github_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  // Update the provider connection
  const updateResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${createResponse.body.id}`, {
    method: "PATCH",
    accessType: "client",
    body: {
      allow_sign_in: true,
      allow_connected_accounts: false,
    },
  });

  expect(updateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "allow_connected_accounts": false,
        "allow_sign_in": true,
        "email": "test@example.com",
        "id": "github",
        "type": "github",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should update an OAuth provider connection on the server", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_id === "github");
  expect(providerConfig).toBeDefined();

  const createResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "test_github_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

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

  expect(updateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "account_id": "test_github_user_123",
        "allow_connected_accounts": true,
        "allow_sign_in": true,
        "email": "updated@example.com",
        "id": "github",
        "type": "github",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should delete an OAuth provider connection", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_id === "github");
  expect(providerConfig).toBeDefined();

  const createResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "test_github_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

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
      "body": "OAuth provider not found for this user",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should return 404 when reading non-existent OAuth provider", async ({ expect }: { expect: any }) => {
  await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const readResponse = await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "GET",
    accessType: "client",
  });

  expect(readResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": "OAuth provider not found for this user",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should return 404 when updating non-existent OAuth provider", async ({ expect }: { expect: any }) => {
  await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const updateResponse = await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "PATCH",
    accessType: "client",
    body: {
      allow_sign_in: true,
    },
  });

  expect(updateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": "OAuth provider not found for this user",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should return 404 when deleting non-existent OAuth provider", async ({ expect }: { expect: any }) => {
  await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const deleteResponse = await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "DELETE",
    accessType: "client",
  });

  expect(deleteResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": "OAuth provider not found for this user",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should forbid client access to other users' OAuth providers", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  const user1 = await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_id === "github");
  expect(providerConfig).toBeDefined();

  await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "test_github_user_1",
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
      provider_id: providerConfig.id,
      account_id: "test_github_user_2",
      email: "test2@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

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
        "id": "github",
        "type": "github",
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

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_id === "github");
  expect(providerConfig).toBeDefined();

  await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "test_github_user_1",
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
      provider_id: providerConfig.id,
      account_id: "test_github_user_2",
      email: "test2@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

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
            "account_id": "test_github_user_1",
            "allow_connected_accounts": true,
            "allow_sign_in": true,
            "email": "test1@example.com",
            "id": "github",
            "type": "github",
            "user_id": "<stripped UUID>",
          },
          {
            "account_id": "test_github_user_2",
            "allow_connected_accounts": true,
            "allow_sign_in": true,
            "email": "test2@example.com",
            "id": "github",
            "type": "github",
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
            "account_id": "test_github_user_1",
            "allow_connected_accounts": true,
            "allow_sign_in": true,
            "email": "test1@example.com",
            "id": "github",
            "type": "github",
            "user_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Server should be able to update user1's OAuth provider from user2's context
  const updateResponse = await niceBackendFetch(`/api/v1/oauth-providers/${user1.userId}/${createResponse2.body.id}`, {
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
        "account_id": "test_github_user_1",
        "allow_connected_accounts": true,
        "allow_sign_in": false,
        "email": "test1@example.com",
        "id": "github",
        "type": "github",
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
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should handle account_id updates correctly", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_id === "github");
  expect(providerConfig).toBeDefined();

  const createResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "test_github_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  // Update the account_id
  const updateResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${createResponse.body.id}`, {
    method: "PATCH",
    accessType: "server",
    body: {
      account_id: "updated_github_user_456",
    },
  });

  expect(updateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "account_id": "updated_github_user_456",
        "allow_connected_accounts": true,
        "allow_sign_in": true,
        "email": "test@example.com",
        "id": "github",
        "type": "github",
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
        "account_id": "updated_github_user_456",
        "allow_connected_accounts": true,
        "allow_sign_in": true,
        "email": "test@example.com",
        "id": "github",
        "type": "github",
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
      provider_id: "github", // This provider is not configured in the project
      account_id: "test_github_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Provider with config ID github is not configured. Please check your Stack Auth dashboard OAuth configuration.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should toggle sign-in and connected accounts capabilities", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_id === "github");
  expect(providerConfig).toBeDefined();

  const createResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "test_github_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  // Toggle off both capabilities
  const toggleOffResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${createResponse.body.id}`, {
    method: "PATCH",
    accessType: "client",
    body: {
      allow_sign_in: false,
      allow_connected_accounts: false,
    },
  });

  expect(toggleOffResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "allow_connected_accounts": false,
        "allow_sign_in": false,
        "email": "test@example.com",
        "id": "github",
        "type": "github",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Toggle on sign-in, keep connected accounts off
  const toggleSignInResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${createResponse.body.id}`, {
    method: "PATCH",
    accessType: "client",
    body: {
      allow_sign_in: true,
      allow_connected_accounts: false,
    },
  });

  expect(toggleSignInResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "allow_connected_accounts": false,
        "allow_sign_in": true,
        "email": "test@example.com",
        "id": "github",
        "type": "github",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Toggle on connected accounts, keep sign-in on
  const toggleConnectedAccountsResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${createResponse.body.id}`, {
    method: "PATCH",
    accessType: "client",
    body: {
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(toggleConnectedAccountsResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "allow_connected_accounts": true,
        "allow_sign_in": true,
        "email": "test@example.com",
        "id": "github",
        "type": "github",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should prevent multiple providers of the same type from being enabled for signing in", async ({ expect }: { expect: any }) => {
  // Test with multiple GitHub accounts (same provider type, different account IDs)
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_id === "github");
  expect(providerConfig).toBeDefined();

  // Create first GitHub account connection with sign-in enabled
  const createResponse1 = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_user_123",
      email: "user123@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse1.status).toBe(201);

  // Try to create second GitHub account connection with sign-in enabled - should fail
  const createResponse2 = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_user_456",
      email: "user456@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "A provider of type \\"github\\" is already enabled for signing in for this user.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Create second GitHub account connection with sign-in disabled - should succeed
  const createResponse3 = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_user_456",
      email: "user456@example.com",
      allow_sign_in: false,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse3.status).toBe(201);
  expect(createResponse3.body.allow_sign_in).toBe(false);

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
      "body": "A provider of type \\"github\\" is already enabled for signing in for this user.",
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

it("should prevent duplicate account IDs for sign-in", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_id === "github");
  expect(providerConfig).toBeDefined();

  // Create first GitHub account connection with connected accounts enabled
  const createResponse1 = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_user_123",
      email: "user123@example.com",
      allow_sign_in: false,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse1.status).toBe(201);

  // Try to create second GitHub account connection with same account ID and connected accounts enabled - should fail
  const createResponse2 = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_user_123", // Same account ID
      email: "user123@example.com",
      allow_sign_in: false,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "OAUTH_PROVIDER_ACCOUNT_ID_ALREADY_USED_FOR_CONNECTED_ACCOUNTS",
        "details": {
          "account_id": "github_user_123",
          "provider_type": "github",
        },
        "error": "A provider of type \\"github\\" with account ID \\"github_user_123\\" is already connected for this user.",
      },
      "headers": Headers {
        "x-stack-known-error": "OAUTH_PROVIDER_ACCOUNT_ID_ALREADY_USED_FOR_CONNECTED_ACCOUNTS",
        <some fields may have been hidden>,
      },
    }
  `);

  // Create second GitHub account connection with different account ID - should succeed
  const createResponse3 = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_user_456", // Different account ID
      email: "user456@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse3.status).toBe(201);
  expect(createResponse3.body.allow_connected_accounts).toBe(true);


  backendContext.set({ mailbox: createMailbox() });
  const user2 = await Auth.Otp.signIn();

  // Try to create a connected account with same account ID for the same user but different details - should fail
  const createResponse5 = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_user_456",
      email: "user456@example.com",
      allow_sign_in: true,
      allow_connected_accounts: false,
    },
  });

  expect(createResponse5.status).toBe(400);
  expect(createResponse5.body.code).toBe("OAUTH_PROVIDER_ACCOUNT_ID_ALREADY_USED_FOR_CONNECTED_ACCOUNTS");
});

// New comprehensive error handling tests
it("should throw OAuthProviderTypeAlreadyUsedForSignIn error on create", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_id === "github");
  expect(providerConfig).toBeDefined();

  // Create first OAuth provider with sign-in enabled
  const firstProviderResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_account_1",
      email: "test1@example.com",
      allow_sign_in: true,
      allow_connected_accounts: false,
    },
  });

  expect(firstProviderResponse.status).toBe(201);
  expect(firstProviderResponse.body.allow_sign_in).toBe(true);

  // Try to create second OAuth provider of same type with sign-in enabled - should fail with specific error
  const secondProviderResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_account_2",
      email: "test2@example.com",
      allow_sign_in: true,
      allow_connected_accounts: false,
    },
  });

  expect(secondProviderResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "OAUTH_PROVIDER_TYPE_ALREADY_USED_FOR_SIGN_IN",
        "details": { "provider_type": "github" },
        "error": "A provider of type \\"github\\" is already used for signing in for a different account.",
      },
      "headers": Headers {
        "x-stack-known-error": "OAUTH_PROVIDER_TYPE_ALREADY_USED_FOR_SIGN_IN",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should throw OAuthProviderTypeAlreadyUsedForSignIn error on update", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_id === "github");
  expect(providerConfig).toBeDefined();

  // Create first OAuth provider with sign-in enabled
  const firstProviderResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_account_1",
      email: "test1@example.com",
      allow_sign_in: true,
      allow_connected_accounts: false,
    },
  });

  expect(firstProviderResponse.status).toBe(201);

  // Create second OAuth provider with sign-in disabled
  const secondProviderResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_account_2",
      email: "test2@example.com",
      allow_sign_in: false,
      allow_connected_accounts: false,
    },
  });

  expect(secondProviderResponse.status).toBe(201);
  expect(secondProviderResponse.body.allow_sign_in).toBe(false);

  // Try to enable sign-in on second provider - should fail with specific error
  const updateResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${secondProviderResponse.body.id}`, {
    method: "PATCH",
    accessType: "server",
    body: {
      allow_sign_in: true,
    },
  });

  expect(updateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "A provider of type \\"github\\" is already enabled for signing in for this user.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should throw OAuthProviderAccountIdAlreadyUsedForConnectedAccounts error on create", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_id === "github");
  expect(providerConfig).toBeDefined();

  // Create first OAuth provider with connected accounts enabled
  const firstProviderResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_account_123",
      email: "test1@example.com",
      allow_sign_in: false,
      allow_connected_accounts: true,
    },
  });

  expect(firstProviderResponse.status).toBe(201);
  expect(firstProviderResponse.body.allow_connected_accounts).toBe(true);

  // Try to create second OAuth provider with same account ID and connected accounts enabled - should fail
  const secondProviderResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_account_123", // Same account ID
      email: "test2@example.com",
      allow_sign_in: false,
      allow_connected_accounts: true,
    },
  });

  expect(secondProviderResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "A provider of type \\"github\\" with account ID \\"github_account_123\\" is already connected for this user.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should throw OAuthProviderAccountIdAlreadyUsedForConnectedAccounts error on update", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_id === "github");
  expect(providerConfig).toBeDefined();

  // Create first OAuth provider with connected accounts enabled
  const firstProviderResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_account_123",
      email: "test1@example.com",
      allow_sign_in: false,
      allow_connected_accounts: true,
    },
  });

  expect(firstProviderResponse.status).toBe(201);

  // Create second OAuth provider with same account ID but connected accounts disabled
  const secondProviderResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_account_123", // Same account ID
      email: "test2@example.com",
      allow_sign_in: false,
      allow_connected_accounts: false,
    },
  });

  expect(secondProviderResponse.status).toBe(201);
  expect(secondProviderResponse.body.allow_connected_accounts).toBe(false);

  // Try to enable connected accounts on second provider - should fail with specific error
  const updateResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${secondProviderResponse.body.id}`, {
    method: "PATCH",
    accessType: "server",
    body: {
      allow_connected_accounts: true,
    },
  });

  expect(updateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "A provider of type \\"github\\" with account ID \\"github_account_123\\" is already connected for this user.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should allow updating account_id when no conflicts exist", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_id === "github");
  expect(providerConfig).toBeDefined();

  // Create first OAuth provider
  const firstProviderResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_account_1",
      email: "test1@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(firstProviderResponse.status).toBe(201);

  // Create second OAuth provider with different account ID
  const secondProviderResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_account_2",
      email: "test2@example.com",
      allow_sign_in: false,
      allow_connected_accounts: false,
    },
  });

  expect(secondProviderResponse.status).toBe(201);

  // Update account_id on second provider to a new unique value - should succeed
  const updateResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${secondProviderResponse.body.id}`, {
    method: "PATCH",
    accessType: "server",
    body: {
      account_id: "github_account_3", // New unique account ID
    },
  });

  expect(updateResponse.status).toBe(200);
  expect(updateResponse.body.account_id).toBe("github_account_3");
});

it("should prevent updating account_id to one that conflicts with connected accounts", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_id === "github");
  expect(providerConfig).toBeDefined();

  // Create first OAuth provider with connected accounts enabled
  const firstProviderResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_account_1",
      email: "test1@example.com",
      allow_sign_in: false,
      allow_connected_accounts: true,
    },
  });

  expect(firstProviderResponse.status).toBe(201);

  // Create second OAuth provider with different account ID but connected accounts enabled
  const secondProviderResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_account_2",
      email: "test2@example.com",
      allow_sign_in: false,
      allow_connected_accounts: true,
    },
  });

  expect(secondProviderResponse.status).toBe(201);

  // Try to update account_id on second provider to conflict with first - should fail
  const updateResponse = await niceBackendFetch(`/api/v1/oauth-providers/me/${secondProviderResponse.body.id}`, {
    method: "PATCH",
    accessType: "server",
    body: {
      account_id: "github_account_1", // Conflicts with first provider's account ID
    },
  });

  expect(updateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "OAUTH_PROVIDER_ACCOUNT_ID_ALREADY_USED_FOR_CONNECTED_ACCOUNTS",
        "details": { "account_id": "github_account_1", "provider_type": "github" },
        "error": "A provider of type \\"github\\" with account ID \\"github_account_1\\" is already connected for this user.",
      },
      "headers": Headers {
        "x-stack-known-error": "OAUTH_PROVIDER_ACCOUNT_ID_ALREADY_USED_FOR_CONNECTED_ACCOUNTS",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should handle mixed error scenarios correctly", async ({ expect }: { expect: any }) => {
  const { createProjectResponse } = await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.provider_id === "github");
  expect(providerConfig).toBeDefined();

  // Create first OAuth provider with both sign-in and connected accounts enabled
  const firstProviderResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_account_1",
      email: "test1@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(firstProviderResponse.status).toBe(201);

  // Try to create second OAuth provider with same account ID and both capabilities - should fail with connected accounts error
  const secondProviderResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_account_1", // Same account ID
      email: "test2@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  // Should fail with the connected accounts error (validation checks connected accounts first)
  expect(secondProviderResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "OAUTH_PROVIDER_TYPE_ALREADY_USED_FOR_SIGN_IN",
        "details": { "provider_type": "github" },
        "error": "A provider of type \\"github\\" is already used for signing in for a different account.",
      },
      "headers": Headers {
        "x-stack-known-error": "OAUTH_PROVIDER_TYPE_ALREADY_USED_FOR_SIGN_IN",
        <some fields may have been hidden>,
      },
    }
  `);

  // Try to create third OAuth provider with different account ID but sign-in enabled - should fail with sign-in error
  const thirdProviderResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_id: providerConfig.id,
      account_id: "github_account_2", // Different account ID
      email: "test3@example.com",
      allow_sign_in: true,
      allow_connected_accounts: false,
    },
  });

  expect(thirdProviderResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "OAUTH_PROVIDER_TYPE_ALREADY_USED_FOR_SIGN_IN",
        "details": { "provider_type": "github" },
        "error": "A provider of type \\"github\\" is already used for signing in for a different account.",
      },
      "headers": Headers {
        "x-stack-known-error": "OAUTH_PROVIDER_TYPE_ALREADY_USED_FOR_SIGN_IN",
        <some fields may have been hidden>,
      },
    }
  `);
});
