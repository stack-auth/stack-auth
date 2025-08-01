import { pick } from "@stackframe/stack-shared/dist/utils/objects";
import { it } from "../../../../../helpers";
import { Project, niceBackendFetch } from "../../../../backend-helpers";


it("client and server should not have access to config overrides", async ({ expect }) => {
  await Project.createAndSwitch();

  // Test client access
  const clientResponse = await niceBackendFetch("/api/v1/internal/config", {
    accessType: "client"
  });
  expect(clientResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "INSUFFICIENT_ACCESS_TYPE",
        "details": {
          "actual_access_type": "client",
          "allowed_access_types": ["admin"],
        },
        "error": "The x-stack-access-type header must be 'admin', but was 'client'.",
      },
      "headers": Headers {
        "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
        <some fields may have been hidden>,
      },
    }
  `);

  // Test server access
  const serverResponse = await niceBackendFetch("/api/v1/internal/config", {
    accessType: "server"
  });
  expect(serverResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "INSUFFICIENT_ACCESS_TYPE",
        "details": {
          "actual_access_type": "server",
          "allowed_access_types": ["admin"],
        },
        "error": "The x-stack-access-type header must be 'admin', but was 'server'.",
      },
      "headers": Headers {
        "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("gets config", async ({ expect }) => {
  const { adminAccessToken } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  const response = await niceBackendFetch("/api/v1/internal/config", {
    method: "GET",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });

  expect(response.status).toBe(200);
  const parsedConfig = JSON.parse(response.body.config_string);
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
  const initialResponse = await niceBackendFetch("/api/v1/internal/config", {
    method: "GET",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });

  expect(initialResponse.status).toBe(200);
  const initialConfig = JSON.parse(initialResponse.body.config_string);

  expect(initialConfig.users.allowClientUserDeletion).toBe(false);
  expect(initialConfig.teams.allowClientTeamCreation).toBe(false);
  expect(initialConfig.teams.createPersonalTeamOnSignUp).toBe(false);

  const updateResponse = await niceBackendFetch("/api/v1/internal/config/override", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      config_override_string: JSON.stringify({
        'users.allowClientUserDeletion': true,
        'teams.allowClientTeamCreation': true,
        'teams.createPersonalTeamOnSignUp': true,
      }),
    },
  });
  expect(updateResponse.status).toBe(200);

  // Verify the changes are persisted by making another GET request
  const verifyResponse = await niceBackendFetch("/api/v1/internal/config", {
    method: "GET",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });

  expect(verifyResponse.status).toBe(200);
  const updatedConfig = JSON.parse(verifyResponse.body.config_string);
  expect(updatedConfig.users.allowClientUserDeletion).toBe(true);
  expect(updatedConfig.teams.allowClientTeamCreation).toBe(true);
  expect(updatedConfig.teams.createPersonalTeamOnSignUp).toBe(true);
});

it("adds, updates, and removes oauth config", async ({ expect }) => {
  const { adminAccessToken } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  // Get initial config to verify no OAuth providers exist
  const initialResponse = await niceBackendFetch("/api/v1/internal/config", {
    method: "GET",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });

  expect(initialResponse.status).toBe(200);
  const initialConfig = JSON.parse(initialResponse.body.config_string);
  expect(initialConfig.auth.oauth.providers).toEqual({});

  // Add a Google OAuth provider
  const addGoogleResponse = await niceBackendFetch("/api/v1/internal/config/override", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      config_override_string: JSON.stringify({
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

  // Add a second OAuth provider (GitHub)
  const addGithubResponse = await niceBackendFetch("/api/v1/internal/config/override", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      config_override_string: JSON.stringify({
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

  const configResponse = await niceBackendFetch("/api/v1/internal/config", {
    method: "GET",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });

  const configWithBoth = JSON.parse(configResponse.body.config_string);
  expect(configWithBoth.auth.oauth.providers.google).toBeDefined();
  expect(configWithBoth.auth.oauth.providers.github).toEqual({
    type: 'github',
    isShared: true,
    allowSignIn: true,
    allowConnectedAccounts: false,
  });

  // Update the Google OAuth provider
  const updateGoogleResponse = await niceBackendFetch("/api/v1/internal/config/override", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      config_override_string: JSON.stringify({
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

  const configResponse2 = await niceBackendFetch("/api/v1/internal/config", {
    method: "GET",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });
  const configWithUpdatedGoogle = JSON.parse(configResponse2.body.config_string);
  expect(configWithUpdatedGoogle.auth.oauth.providers.google).toEqual({
    type: 'google',
    isShared: true,
    allowSignIn: false,
    allowConnectedAccounts: true,
  });
  // GitHub should still be there
  expect(configWithUpdatedGoogle.auth.oauth.providers.github).toBeDefined();

  // Remove the GitHub OAuth provider
  const removeGithubResponse = await niceBackendFetch("/api/v1/internal/config/override", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      config_override_string: JSON.stringify({
        'auth.oauth.providers.github': null,
      }),
    },
  });

  expect(removeGithubResponse.status).toBe(200);

  const configResponse3 = await niceBackendFetch("/api/v1/internal/config", {
    method: "GET",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });
  const configWithoutGithub = JSON.parse(configResponse3.body.config_string);
  expect(configWithoutGithub.auth.oauth.providers.github).toBeUndefined();
  // Google should still be there
  expect(configWithoutGithub.auth.oauth.providers.google).toBeDefined();
});

it("doesn't allow duplicated oauth ids", async ({ expect }) => {
  const { adminAccessToken } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  // However, trying to create multiple providers with same OAuth ID in single request should fail
  // or at minimum, only the last one should be applied
  const multipleWithSameIdResponse = await niceBackendFetch("/api/v1/internal/config/override", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      config_override_string: `
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

it("returns an error when the oauth config is misconfigured", async ({ expect }) => {
  const { adminAccessToken } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  // Test invalid OAuth provider type
  const invalidTypeResponse = await niceBackendFetch("/api/v1/internal/config/override", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      config_override_string: JSON.stringify({
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

  expect(invalidTypeResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "[ERROR] auth.oauth.providers.invalid.type must be one of the following values: google, github, microsoft, spotify, facebook, discord, gitlab, bitbucket, linkedin, apple, x, twitch",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("returns an error when config override contains non-existent fields", async ({ expect }) => {
  const { adminAccessToken } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  // Test non-existent top-level field
  const invalidTopLevelResponse = await niceBackendFetch("/api/v1/internal/config/override", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      config_override_string: JSON.stringify({
        'nonExistentField': 'some-value',
      }),
    },
  });

  expect(invalidTopLevelResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "[ERROR] The key \\"nonExistentField\\" is not valid for the schema.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("adds, updates, and removes domains", async ({ expect }) => {
  const { adminAccessToken } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  // Get initial config to verify no trusted domains exist
  const initialResponse = await niceBackendFetch("/api/v1/internal/config", {
    method: "GET",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });

  expect(initialResponse.status).toBe(200);
  const initialConfig = JSON.parse(initialResponse.body.config_string);
  expect(initialConfig.domains.trustedDomains).toEqual({});

  // Add a first trusted domain
  const addFirstDomainResponse = await niceBackendFetch("/api/v1/internal/config/override", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      config_override_string: JSON.stringify({
        'domains.trustedDomains.domain-1': {
          baseUrl: 'https://example.com',
          handlerPath: '/auth/handler',
        },
      }),
    },
  });

  expect(addFirstDomainResponse.status).toBe(200);

  const configResponse = await niceBackendFetch("/api/v1/internal/config", {
    method: "GET",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });

  const configWithFirstDomain = JSON.parse(configResponse.body.config_string);
  expect(configWithFirstDomain.domains.trustedDomains['domain-1']).toEqual({
    baseUrl: 'https://example.com',
    handlerPath: '/auth/handler',
  });

  // Add a second trusted domain
  const addSecondDomainResponse = await niceBackendFetch("/api/v1/internal/config/override", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      config_override_string: JSON.stringify({
        'domains.trustedDomains.domain-2': {
          baseUrl: 'https://app.example.com',
          handlerPath: '/handler',
        },
      }),
    },
  });

  expect(addSecondDomainResponse.status).toBe(200);

  const configResponse2 = await niceBackendFetch("/api/v1/internal/config", {
    method: "GET",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });
  const configWithBothDomains = JSON.parse(configResponse2.body.config_string);
  expect(configWithBothDomains.domains.trustedDomains['domain-1']).toBeDefined();
  expect(configWithBothDomains.domains.trustedDomains['domain-2']).toEqual({
    baseUrl: 'https://app.example.com',
    handlerPath: '/handler',
  });

  // Update the first domain
  const updateFirstDomainResponse = await niceBackendFetch("/api/v1/internal/config/override", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      config_override_string: JSON.stringify({
        'domains.trustedDomains.domain-1': {
          baseUrl: 'https://updated.example.com',
          handlerPath: '/new-handler',
        },
      }),
    },
  });

  expect(updateFirstDomainResponse.status).toBe(200);

  const configResponse3 = await niceBackendFetch("/api/v1/internal/config", {
    method: "GET",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });

  const configWithUpdatedDomain = JSON.parse(configResponse3.body.config_string);
  expect(configWithUpdatedDomain.domains.trustedDomains['domain-1']).toEqual({
    baseUrl: 'https://updated.example.com',
    handlerPath: '/new-handler',
  });
  // Second domain should still be there
  expect(configWithUpdatedDomain.domains.trustedDomains['domain-2']).toBeDefined();
});
