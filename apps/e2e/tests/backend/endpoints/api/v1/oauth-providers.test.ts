import { randomUUID } from "node:crypto";
import { it } from "../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../backend-helpers";

async function createAndSwitchToOAuthEnabledProject() {
  return await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
      oauth_providers: [
        {
          id: randomUUID(),
          type: "github",
          is_shared: false,
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

  const providerConfig = createProjectResponse.body.config.oauth_providers.find((p: any) => p.id === "github");
  expect(providerConfig).toBeDefined();

  const createResponse = await niceBackendFetch("/api/v1/oauth-providers", {
    method: "POST",
    accessType: "server",
    body: {
      user_id: "me",
      provider_config_id: providerConfig.id,
      account_id: "test_github_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/oauth-providers:
              - body.provider_config_id must be a valid UUID
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/oauth-providers:
            - body.provider_config_id must be a valid UUID
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should read an OAuth provider connection", async ({ expect }: { expect: any }) => {
  await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  // First create a provider connection
  await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "POST",
    accessType: "server",
    body: {
      type: "github",
      account_id: "test_github_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  // Then read it
  const readResponse = await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "GET",
    accessType: "client",
  });

  expect(readResponse).toMatchInlineSnapshot(``);
});

it("should list all OAuth provider connections for a user", async ({ expect }: { expect: any }) => {
  await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  // Create a provider connection
  await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "POST",
    accessType: "server",
    body: {
      type: "github",
      account_id: "test_github_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: false,
    },
  });

  // List all providers
  const listResponse = await niceBackendFetch("/api/v1/oauth-providers/me", {
    method: "GET",
    accessType: "client",
  });

  expect(listResponse).toMatchInlineSnapshot(``);
});

it("should update an OAuth provider connection", async ({ expect }: { expect: any }) => {
  await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  // Create a provider connection
  await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "POST",
    accessType: "server",
    body: {
      type: "github",
      account_id: "test_github_user_123",
      email: "test@example.com",
      allow_sign_in: false,
      allow_connected_accounts: false,
    },
  });

  // Update the provider connection
  const updateResponse = await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "PATCH",
    accessType: "client",
    body: {
      allow_sign_in: true,
      allow_connected_accounts: true,
      email: "updated@example.com",
    },
  });

  expect(updateResponse).toMatchInlineSnapshot(``);
});

it("should delete an OAuth provider connection", async ({ expect }: { expect: any }) => {
  await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  // Create a provider connection
  await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "POST",
    accessType: "server",
    body: {
      type: "github",
      account_id: "test_github_user_123",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  // Delete the provider connection
  const deleteResponse = await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "DELETE",
    accessType: "client",
  });

  expect(deleteResponse).toMatchInlineSnapshot(``);

  // Verify it's deleted by trying to read it
  const readAfterDeleteResponse = await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "GET",
    accessType: "client",
  });

  expect(readAfterDeleteResponse).toMatchInlineSnapshot(``);
});

it("should return 404 when reading non-existent OAuth provider", async ({ expect }: { expect: any }) => {
  await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const readResponse = await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "GET",
    accessType: "client",
  });

  expect(readResponse).toMatchInlineSnapshot(``);
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

  expect(updateResponse).toMatchInlineSnapshot(``);
});

it("should return 404 when deleting non-existent OAuth provider", async ({ expect }: { expect: any }) => {
  await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const deleteResponse = await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "DELETE",
    accessType: "client",
  });

  expect(deleteResponse).toMatchInlineSnapshot(``);
});

it("should forbid client access to other users' OAuth providers", async ({ expect }: { expect: any }) => {
  await createAndSwitchToOAuthEnabledProject();

  // Create first user
  const user1 = await Auth.Otp.signIn();

  // Create OAuth provider for user1
  await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "POST",
    accessType: "server",
    body: {
      type: "github",
      account_id: "test_github_user_123",
      email: "user1@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  // Create second user
  const user2 = await Auth.Otp.signIn();

  // Try to access user1's OAuth provider as user2
  const readResponse = await niceBackendFetch(`/api/v1/oauth-providers/${user1.userId}/github`, {
    method: "GET",
    accessType: "client",
  });

  expect(readResponse).toMatchInlineSnapshot(``);

  // Try to list user1's OAuth providers as user2
  const listResponse = await niceBackendFetch(`/api/v1/oauth-providers/${user1.userId}`, {
    method: "GET",
    accessType: "client",
  });

  expect(listResponse).toMatchInlineSnapshot(``);

  // Try to update user1's OAuth provider as user2
  const updateResponse = await niceBackendFetch(`/api/v1/oauth-providers/${user1.userId}/github`, {
    method: "PATCH",
    accessType: "client",
    body: {
      allow_sign_in: false,
    },
  });

  expect(updateResponse).toMatchInlineSnapshot(``);

  // Try to delete user1's OAuth provider as user2
  const deleteResponse = await niceBackendFetch(`/api/v1/oauth-providers/${user1.userId}/github`, {
    method: "DELETE",
    accessType: "client",
  });

  expect(deleteResponse).toMatchInlineSnapshot(``);
});

it("should allow server access to any user's OAuth providers", async ({ expect }: { expect: any }) => {
  await createAndSwitchToOAuthEnabledProject();

  // Create first user
  const user1 = await Auth.Otp.signIn();

  // Create OAuth provider for user1
  await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "POST",
    accessType: "server",
    body: {
      type: "github",
      account_id: "test_github_user_123",
      email: "user1@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  // Create second user
  const user2 = await Auth.Otp.signIn();

  // Access user1's OAuth provider as server (should work)
  const readResponse = await niceBackendFetch(`/api/v1/oauth-providers/${user1.userId}/github`, {
    method: "GET",
    accessType: "server",
  });

  expect(readResponse).toMatchInlineSnapshot(``);

  // List user1's OAuth providers as server (should work)
  const listResponse = await niceBackendFetch(`/api/v1/oauth-providers/${user1.userId}`, {
    method: "GET",
    accessType: "server",
  });

  expect(listResponse).toMatchInlineSnapshot(``);

  // Update user1's OAuth provider as server (should work)
  const updateResponse = await niceBackendFetch(`/api/v1/oauth-providers/${user1.userId}/github`, {
    method: "PATCH",
    accessType: "server",
    body: {
      allow_sign_in: false,
      email: "updated@example.com",
    },
  });

  expect(updateResponse).toMatchInlineSnapshot(``);
});

it("should handle account_id updates correctly", async ({ expect }: { expect: any }) => {
  await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  // Create a provider connection
  await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "POST",
    accessType: "server",
    body: {
      type: "github",
      account_id: "original_account_id",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  // Update the account_id
  const updateResponse = await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "PATCH",
    accessType: "client",
    body: {
      account_id: "new_account_id",
    },
  });

  expect(updateResponse).toMatchInlineSnapshot(``);

  // Verify the account_id was updated
  const readResponse = await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "GET",
    accessType: "client",
  });

  expect(readResponse).toMatchInlineSnapshot(``);
});

it("should return empty list when user has no OAuth providers", async ({ expect }: { expect: any }) => {
  await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  const listResponse = await niceBackendFetch("/api/v1/oauth-providers/me", {
    method: "GET",
    accessType: "client",
  });

  expect(listResponse).toMatchInlineSnapshot(``);
});

it("should handle provider not configured error", async ({ expect }: { expect: any }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } }); // No OAuth providers configured
  await Auth.Otp.signIn();

  const createResponse = await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "POST",
    accessType: "server",
    body: {
      type: "github",
      account_id: "test_account",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(createResponse).toMatchInlineSnapshot(``);
});

it("should toggle sign-in and connected accounts capabilities", async ({ expect }: { expect: any }) => {
  await createAndSwitchToOAuthEnabledProject();
  await Auth.Otp.signIn();

  // Create provider with both capabilities enabled
  await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "POST",
    accessType: "server",
    body: {
      type: "github",
      account_id: "test_account",
      email: "test@example.com",
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  // Disable sign-in capability
  const disableSignInResponse = await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "PATCH",
    accessType: "client",
    body: {
      allow_sign_in: false,
    },
  });

  expect(disableSignInResponse).toMatchInlineSnapshot(``);

  // Disable connected accounts capability
  const disableConnectedAccountsResponse = await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "PATCH",
    accessType: "client",
    body: {
      allow_connected_accounts: false,
    },
  });

  expect(disableConnectedAccountsResponse).toMatchInlineSnapshot(``);

  // Re-enable both capabilities
  const enableBothResponse = await niceBackendFetch("/api/v1/oauth-providers/me/github", {
    method: "PATCH",
    accessType: "client",
    body: {
      allow_sign_in: true,
      allow_connected_accounts: true,
    },
  });

  expect(enableBothResponse).toMatchInlineSnapshot(``);
});
