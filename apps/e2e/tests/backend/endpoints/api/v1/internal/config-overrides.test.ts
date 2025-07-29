import { pick } from "@stackframe/stack-shared/dist/utils/objects";
import { it } from "../../../../../helpers";
import { Project, niceBackendFetch } from "../../../../backend-helpers";


it("client and server should not have access to config overrides", async ({ expect }) => {
  await Project.createAndSwitch();

  // Test client access
  const clientResponse = await niceBackendFetch("/api/v1/internal/config-overrides", {
    accessType: "client"
  });
  expect(clientResponse.status).toBe(401);

  // Test server access
  const serverResponse = await niceBackendFetch("/api/v1/internal/config-overrides", {
    accessType: "server"
  });
  expect(serverResponse.status).toBe(401);
});

it("gets config", async ({ expect }) => {
  const { adminAccessToken } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  const response = await niceBackendFetch("/api/v1/internal/config-overrides", {
    method: "GET",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });

  expect(response.status).toBe(200);
  const parsedConfig = JSON.parse(response.body.config);
  expect(pick(parsedConfig, ["auth", "domains", 'users', 'teams'])).toMatchInlineSnapshot(`
    {
      "auth": {
        "allowSignUp": true,
        "oauth": {
          "accountMergeStrategy": "link_method",
          "providers": {},
        },
        "otp": { "allowSignIn": true },
        "passkey": { "allowSignIn": false },
        "password": { "allowSignIn": true },
      },
      "domains": {
        "allowLocalhost": true,
        "trustedDomains": {},
      },
      "teams": {
        "allowClientTeamCreation": false,
        "createPersonalTeamOnSignUp": false,
      },
      "users": { "allowClientUserDeletion": false },
    }
  `);
});

it("updates basic config", async ({ expect }) => {
  const { adminAccessToken } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  // Get initial config
  const initialResponse = await niceBackendFetch("/api/v1/internal/config-overrides", {
    method: "GET",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });

  expect(initialResponse.status).toBe(200);
  const initialConfig = JSON.parse(initialResponse.body.config);

  expect(initialConfig.users.allowClientUserDeletion).toBe(false);
  expect(initialConfig.teams.allowClientTeamCreation).toBe(false);
  expect(initialConfig.teams.createPersonalTeamOnSignUp).toBe(false);

  const updateResponse = await niceBackendFetch("/api/v1/internal/config-overrides", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      config: JSON.stringify({
        'users.allowClientUserDeletion': true,
        'teams.allowClientTeamCreation': true,
        'teams.createPersonalTeamOnSignUp': true,
      }),
    },
  });

  expect(updateResponse.status).toBe(200);
  const returnedConfig = JSON.parse(updateResponse.body.config);
  expect(returnedConfig.users.allowClientUserDeletion).toBe(true);
  expect(returnedConfig.teams.allowClientTeamCreation).toBe(true);
  expect(returnedConfig.teams.createPersonalTeamOnSignUp).toBe(true);

  // Verify the changes are persisted by making another GET request
  const verifyResponse = await niceBackendFetch("/api/v1/internal/config-overrides", {
    method: "GET",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });

  expect(verifyResponse.status).toBe(200);
  const persistedConfig = JSON.parse(verifyResponse.body.config);
  expect(persistedConfig.users.allowClientUserDeletion).toBe(true);
  expect(persistedConfig.teams.allowClientTeamCreation).toBe(true);
  expect(persistedConfig.teams.createPersonalTeamOnSignUp).toBe(true);
});

it("adds, updates, and removes oauth config", async ({ expect }) => {
  const { adminAccessToken } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  // Get initial config to verify no OAuth providers exist
  const initialResponse = await niceBackendFetch("/api/v1/internal/config-overrides", {
    method: "GET",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });

  expect(initialResponse.status).toBe(200);
  const initialConfig = JSON.parse(initialResponse.body.config);
  expect(initialConfig.auth.oauth.providers).toEqual({});

  // Add a Google OAuth provider
  const addGoogleResponse = await niceBackendFetch("/api/v1/internal/config-overrides", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      config: JSON.stringify({
        'auth.oauth.providers.google': {
          type: 'google',
          isShared: false,
          clientId: 'google-client-id',
          clientSecret: 'google-client-secret',
          allowSignIn: true,
          allowConnectedAccounts: true,
        },
      }),
    },
  });

  expect(addGoogleResponse.status).toBe(200);
  const configWithGoogle = JSON.parse(addGoogleResponse.body.config);
  expect(configWithGoogle.auth.oauth.providers.google).toEqual({
    type: 'google',
    isShared: false,
    clientId: 'google-client-id',
    clientSecret: 'google-client-secret',
    allowSignIn: true,
    allowConnectedAccounts: true,
  });

  // Add a second OAuth provider (GitHub)
  const addGithubResponse = await niceBackendFetch("/api/v1/internal/config-overrides", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      config: JSON.stringify({
        'auth.oauth.providers.github': {
          type: 'github',
          isShared: true,
          allowSignIn: true,
          allowConnectedAccounts: false,
        },
      }),
    },
  });

  expect(addGithubResponse.status).toBe(200);
  const configWithBoth = JSON.parse(addGithubResponse.body.config);
  expect(configWithBoth.auth.oauth.providers.google).toBeDefined();
  expect(configWithBoth.auth.oauth.providers.github).toEqual({
    type: 'github',
    isShared: true,
    allowSignIn: true,
    allowConnectedAccounts: false,
  });

  // Update the Google OAuth provider
  const updateGoogleResponse = await niceBackendFetch("/api/v1/internal/config-overrides", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      config: JSON.stringify({
        'auth.oauth.providers.google': {
          type: 'google',
          isShared: true,
          allowSignIn: false,
          allowConnectedAccounts: true,
        },
      }),
    },
  });

  expect(updateGoogleResponse.status).toBe(200);
  const configWithUpdatedGoogle = JSON.parse(updateGoogleResponse.body.config);
  expect(configWithUpdatedGoogle.auth.oauth.providers.google).toEqual({
    type: 'google',
    isShared: true,
    allowSignIn: false,
    allowConnectedAccounts: true,
  });
  // GitHub should still be there
  expect(configWithUpdatedGoogle.auth.oauth.providers.github).toBeDefined();

  // Remove the GitHub OAuth provider
  const removeGithubResponse = await niceBackendFetch("/api/v1/internal/config-overrides", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      config: JSON.stringify({
        'auth.oauth.providers.github': null,
      }),
    },
  });

  expect(removeGithubResponse.status).toBe(200);
  const configWithoutGithub = JSON.parse(removeGithubResponse.body.config);
  expect(configWithoutGithub.auth.oauth.providers.github).toBeUndefined();
  // Google should still be there
  expect(configWithoutGithub.auth.oauth.providers.google).toBeDefined();

  // Remove the Google OAuth provider
  const removeGoogleResponse = await niceBackendFetch("/api/v1/internal/config-overrides", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      config: JSON.stringify({
        'auth.oauth.providers.google': null,
      }),
    },
  });

  expect(removeGoogleResponse.status).toBe(200);
  const finalConfig = JSON.parse(removeGoogleResponse.body.config);
  expect(finalConfig.auth.oauth.providers).toEqual({});

  // Verify the changes are persisted by making another GET request
  const verifyResponse = await niceBackendFetch("/api/v1/internal/config-overrides", {
    method: "GET",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });

  expect(verifyResponse.status).toBe(200);
  const persistedConfig = JSON.parse(verifyResponse.body.config);
  expect(persistedConfig.auth.oauth.providers).toEqual({});
});

it("doesn't allow duplicated oauth ids", async ({ expect }) => {
  const { adminAccessToken } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  // However, trying to create multiple providers with same OAuth ID in single request should fail
  // or at minimum, only the last one should be applied
  const multipleWithSameIdResponse = await niceBackendFetch("/api/v1/internal/config-overrides", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      config: `
      {
        "auth.oauth.providers.duplicate": {
            "type":"google",
            "isShared":false,
            "clientId":"google-client-id",
            "clientSecret":"google-client-secret",
            "allowSignIn":true,
            "allowConnectedAccounts":true
        },
        "auth.oauth.providers.duplicate": {
            "type":"google",
            "isShared":false,
            "clientId":"google-client-id",
            "clientSecret":"google-client-secret",
            "allowSignIn":true,
            "allowConnectedAccounts":true
        },
      }`,
    },
  });

  expect(multipleWithSameIdResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Invalid config JSON",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("misconfigures oauth config", async ({ expect }) => {
  const { adminAccessToken } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  // Test invalid OAuth provider type
  const invalidTypeResponse = await niceBackendFetch("/api/v1/internal/config-overrides", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      config: JSON.stringify({
        'auth.oauth.providers.invalid': {
          type: 'invalid-provider',
          isShared: false,
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          allowSignIn: true,
          allowConnectedAccounts: true,
        },
      }),
    },
  });

  expect(invalidTypeResponse.status).toBe(400);

  // Test missing required fields for non-shared provider
  const missingFieldsResponse = await niceBackendFetch("/api/v1/internal/config-overrides", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      config: JSON.stringify({
        'auth.oauth.providers.google': {
          type: 'google',
          isShared: false,
          allowSignIn: true,
          allowConnectedAccounts: true,
          // Missing clientId and clientSecret
        },
      }),
    },
  });

  expect(missingFieldsResponse.status).toBe(400);

  // Test invalid JSON
  const invalidJsonResponse = await niceBackendFetch("/api/v1/internal/config-overrides", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      config: "invalid json",
    },
  });

  expect(invalidJsonResponse.status).toBe(400);
});

it.todo("adds, updates, and removes domains");

it.todo("misconfigures domains");

it.todo("adds, updates, and removes email config");

it.todo("misconfigures email config");
