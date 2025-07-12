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
