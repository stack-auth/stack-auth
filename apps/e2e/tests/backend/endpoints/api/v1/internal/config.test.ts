import { DEFAULT_EMAIL_THEME_ID } from "@stackframe/stack-shared/dist/helpers/emails";
import { pick } from "@stackframe/stack-shared/dist/utils/objects";
import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { Project, niceBackendFetch } from "../../../../backend-helpers";


// Helper to create admin headers with a given token
const adminHeaders = (token: string) => ({
  'x-stack-admin-access-token': token,
});


describe("access control", () => {
  it("client and server should not have access to config endpoints", async ({ expect }) => {
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
});


describe("basic config operations", () => {
  it("gets config", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    const response = await niceBackendFetch("/api/v1/internal/config", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
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
          "otp": { "allowSignIn": false },
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
    const { adminAccessToken } = await Project.createAndSwitch();

    // Get initial config
    const initialResponse = await niceBackendFetch("/api/v1/internal/config", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });

    expect(initialResponse.status).toBe(200);
    const initialConfig = JSON.parse(initialResponse.body.config_string);

    expect(initialConfig.users.allowClientUserDeletion).toBe(false);
    expect(initialConfig.teams.allowClientTeamCreation).toBe(false);
    expect(initialConfig.teams.createPersonalTeamOnSignUp).toBe(false);

    const updateResponse = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
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
      headers: adminHeaders(adminAccessToken),
    });

    expect(verifyResponse.status).toBe(200);
    const updatedConfig = JSON.parse(verifyResponse.body.config_string);
    expect(updatedConfig.users.allowClientUserDeletion).toBe(true);
    expect(updatedConfig.teams.allowClientTeamCreation).toBe(true);
    expect(updatedConfig.teams.createPersonalTeamOnSignUp).toBe(true);
  });

  it("returns an error when config override contains non-existent fields", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    const invalidTopLevelResponse = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_override_string: JSON.stringify({
          'nonExistentField': 'some-value',
        }),
      },
    });

    expect(invalidTopLevelResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": "The key \\"nonExistentField\\" is not valid (nested object not found in schema: \\"nonExistentField\\").",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });

  it("rejects invalid JSON in config_override_string", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    const response = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_override_string: "{ invalid json }",
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toContain("Invalid config JSON");
  });

  it("rejects invalid JSON in config_string for PUT", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    const response = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "PUT",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_string: "not valid json at all",
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toContain("Invalid config JSON");
  });

  it("handles empty config for PUT", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    // First set some values
    const patchResponse = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_override_string: JSON.stringify({
          'teams.allowClientTeamCreation': true,
        }),
      },
    });
    expect(patchResponse.status).toBe(200);

    // PUT empty config to clear
    const putResponse = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "PUT",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_string: JSON.stringify({}),
      },
    });
    expect(putResponse.status).toBe(200);

    // Verify config is empty
    const getResponse = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });
    expect(JSON.parse(getResponse.body.config_string)).toEqual({});
  });
});


describe("oauth config", () => {
  it("adds, updates, and removes oauth config", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    // Get initial config to verify no OAuth providers exist
    const initialResponse = await niceBackendFetch("/api/v1/internal/config", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });

    expect(initialResponse.status).toBe(200);
    const initialConfig = JSON.parse(initialResponse.body.config_string);
    expect(initialConfig.auth.oauth.providers).toEqual({});

    // Add a Google OAuth provider
    const addGoogleResponse = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
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
    const addGithubResponse = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
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
      headers: adminHeaders(adminAccessToken),
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
    const updateGoogleResponse = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
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
      headers: adminHeaders(adminAccessToken),
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
    const removeGithubResponse = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
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
      headers: adminHeaders(adminAccessToken),
    });
    const configWithoutGithub = JSON.parse(configResponse3.body.config_string);
    expect(configWithoutGithub.auth.oauth.providers.github).toBeUndefined();
    // Google should still be there
    expect(configWithoutGithub.auth.oauth.providers.google).toBeDefined();
  });

  it("returns an error when the oauth config is misconfigured", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    // Test invalid OAuth provider type
    const invalidTypeResponse = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
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
        "body": "auth.oauth.providers.invalid.type must be one of the following values: google, github, microsoft, spotify, facebook, discord, gitlab, bitbucket, linkedin, apple, x, twitch",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });
});


describe("domain config", () => {
  it("adds and updates domains", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    // Get initial config to verify no trusted domains exist
    const initialResponse = await niceBackendFetch("/api/v1/internal/config", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });

    expect(initialResponse.status).toBe(200);
    const initialConfig = JSON.parse(initialResponse.body.config_string);
    expect(initialConfig.domains.trustedDomains).toEqual({});

    // Add a first trusted domain
    const addFirstDomainResponse = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
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
      headers: adminHeaders(adminAccessToken),
    });

    const configWithFirstDomain = JSON.parse(configResponse.body.config_string);
    expect(configWithFirstDomain.domains.trustedDomains['domain-1']).toEqual({
      baseUrl: 'https://example.com',
      handlerPath: '/auth/handler',
    });

    // Add a second trusted domain
    const addSecondDomainResponse = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
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
      headers: adminHeaders(adminAccessToken),
    });
    const configWithBothDomains = JSON.parse(configResponse2.body.config_string);
    expect(configWithBothDomains.domains.trustedDomains['domain-1']).toBeDefined();
    expect(configWithBothDomains.domains.trustedDomains['domain-2']).toEqual({
      baseUrl: 'https://app.example.com',
      handlerPath: '/handler',
    });

    // Update the first domain
    const updateFirstDomainResponse = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
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
      headers: adminHeaders(adminAccessToken),
    });

    const configWithUpdatedDomain = JSON.parse(configResponse3.body.config_string);
    expect(configWithUpdatedDomain.domains.trustedDomains['domain-1']).toEqual({
      baseUrl: 'https://updated.example.com',
      handlerPath: '/new-handler',
    });
    // Second domain should still be there
    expect(configWithUpdatedDomain.domains.trustedDomains['domain-2']).toBeDefined();
  });
});


describe("email config", () => {
  it("only keeps custom email templates when using a dedicated email server", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    const customTemplate = {
      displayName: "Custom Reset",
      tsxSource: "export const EmailTemplate = () => null;",
      themeId: DEFAULT_EMAIL_THEME_ID,
    };
    const customTemplateId = "11111111-1111-4111-8111-111111111111";

    const configureServer = (server: Record<string, unknown>) => niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_override_string: JSON.stringify({
          'emails.server': server,
        }),
      },
    });
    const upsertTemplate = (template: typeof customTemplate | null) => niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_override_string: JSON.stringify({
          [`emails.templates.${customTemplateId}`]: template,
        }),
      },
    });

    const dedicatedServer = {
      isShared: false,
      provider: 'smtp',
      host: 'smtp.example.com',
      port: 587,
      username: 'smtp-user',
      password: 'smtp-pass',
      senderName: 'Stack',
      senderEmail: 'noreply@example.com',
    };

    const setDedicatedResponse = await configureServer(dedicatedServer);
    expect(setDedicatedResponse.status).toBe(200);

    const addTemplateResponse = await upsertTemplate(customTemplate);
    expect(addTemplateResponse.status).toBe(200);

    const initialConfigResponse = await niceBackendFetch("/api/v1/internal/config", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });
    const initialConfig = JSON.parse(initialConfigResponse.body.config_string);
    expect(initialConfig.emails.server.isShared).toBe(false);
    expect(initialConfig.emails.templates[customTemplateId]).toEqual(customTemplate);

    const setSharedResponse = await configureServer({
      isShared: true,
      provider: 'smtp',
    });
    expect(setSharedResponse.status).toBe(200);

    const sharedConfigResponse = await niceBackendFetch("/api/v1/internal/config", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });
    const sharedConfig = JSON.parse(sharedConfigResponse.body.config_string);
    expect(sharedConfig.emails.server.isShared).toBe(true);
    expect(sharedConfig.emails.templates[customTemplateId]).toBeUndefined();

    const restoreDedicatedResponse = await configureServer(dedicatedServer);
    expect(restoreDedicatedResponse.status).toBe(200);

    const dedicatedConfigResponse = await niceBackendFetch("/api/v1/internal/config", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });
    const dedicatedConfig = JSON.parse(dedicatedConfigResponse.body.config_string);
    expect(dedicatedConfig.emails.server.isShared).toBe(false);
    expect(dedicatedConfig.emails.templates[customTemplateId]).toEqual(customTemplate);
  });
});


describe("branch and environment levels", () => {
  it("updates config at branch level via path param", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    // Get initial config
    const initialResponse = await niceBackendFetch("/api/v1/internal/config", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });

    expect(initialResponse.status).toBe(200);
    const initialConfig = JSON.parse(initialResponse.body.config_string);
    expect(initialConfig.teams.allowClientTeamCreation).toBe(false);

    // Update at branch level via path param
    const updateResponse = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_override_string: JSON.stringify({
          'teams.allowClientTeamCreation': true,
        }),
      },
    });
    expect(updateResponse.status).toBe(200);

    // Verify the changes are reflected in the rendered config
    const verifyResponse = await niceBackendFetch("/api/v1/internal/config", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });

    expect(verifyResponse.status).toBe(200);
    const updatedConfig = JSON.parse(verifyResponse.body.config_string);
    expect(updatedConfig.teams.allowClientTeamCreation).toBe(true);
  });

  it("branch and environment level overrides are independent", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    // Set a value at branch level
    const branchUpdateResponse = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_override_string: JSON.stringify({
          'teams.allowClientTeamCreation': true,
        }),
      },
    });
    expect(branchUpdateResponse.status).toBe(200);

    // Set a different value at environment level
    const envUpdateResponse = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_override_string: JSON.stringify({
          'users.allowClientUserDeletion': true,
        }),
      },
    });
    expect(envUpdateResponse.status).toBe(200);

    // Verify both changes are reflected in the rendered config
    const verifyResponse = await niceBackendFetch("/api/v1/internal/config", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });

    expect(verifyResponse.status).toBe(200);
    const config = JSON.parse(verifyResponse.body.config_string);
    expect(config.teams.allowClientTeamCreation).toBe(true);
    expect(config.users.allowClientUserDeletion).toBe(true);
  });

  it("environment level overrides take precedence over branch level", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    // Set a value at branch level
    const branchUpdateResponse = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_override_string: JSON.stringify({
          'teams.allowClientTeamCreation': true,
        }),
      },
    });
    expect(branchUpdateResponse.status).toBe(200);

    // Override the same value at environment level
    const envUpdateResponse = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_override_string: JSON.stringify({
          'teams.allowClientTeamCreation': false,
        }),
      },
    });
    expect(envUpdateResponse.status).toBe(200);

    // Environment level should take precedence
    const verifyResponse = await niceBackendFetch("/api/v1/internal/config", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });

    expect(verifyResponse.status).toBe(200);
    const config = JSON.parse(verifyResponse.body.config_string);
    expect(config.teams.allowClientTeamCreation).toBe(false);
  });

  it("rejects invalid level path parameter", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    const response = await niceBackendFetch("/api/v1/internal/config/override/invalid-level", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_override_string: JSON.stringify({
          'teams.allowClientTeamCreation': true,
        }),
      },
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("SCHEMA_ERROR");
    expect(response.body.error).toContain("params.level must be one of the following values: branch, environment");
  });
});


describe("level-specific field restrictions", () => {
  it("rejects environment-only fields (trusted domains) at branch level", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    // domains.trustedDomains is only available at environment level
    const response = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_override_string: JSON.stringify({
          'domains.trustedDomains.my-domain': {
            baseUrl: 'https://example.com',
            handlerPath: '/auth/handler',
          },
        }),
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toContain("domains.trustedDomains");
  });

  it("rejects environment-only fields (email server config) at branch level", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    // emails.server is only available at environment level
    const response = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_override_string: JSON.stringify({
          'emails.server': {
            isShared: false,
            provider: 'smtp',
            host: 'smtp.example.com',
            port: 587,
            username: 'user',
            password: 'pass',
            senderName: 'Test',
            senderEmail: 'test@example.com',
          },
        }),
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toContain("emails.server");
  });

  it("rejects environment-only fields (oauth secrets) at branch level", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    // OAuth clientId and clientSecret are only available at environment level
    const response = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_override_string: JSON.stringify({
          'auth.oauth.providers.google': {
            type: 'google',
            isShared: false,
            clientId: 'test-client-id',
            clientSecret: 'test-client-secret',
            allowSignIn: true,
            allowConnectedAccounts: true,
          },
        }),
      },
    });

    expect(response.status).toBe(400);
    // Should reject because isShared, clientId, clientSecret are environment-only
    expect(response.body).toContain("auth.oauth.providers");
  });

  it("allows branch-level fields at environment level", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    // Branch-level fields should also work at environment level
    const response = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_override_string: JSON.stringify({
          'teams.allowClientTeamCreation': true,
          'users.allowClientUserDeletion': true,
        }),
      },
    });

    expect(response.status).toBe(200);

    // Verify the changes
    const verifyResponse = await niceBackendFetch("/api/v1/internal/config", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });

    const config = JSON.parse(verifyResponse.body.config_string);
    expect(config.teams.allowClientTeamCreation).toBe(true);
    expect(config.users.allowClientUserDeletion).toBe(true);
  });

  it("allows valid branch-level oauth config at branch level", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    // allowSignIn and allowConnectedAccounts are branch-level fields
    // Note: provider ID must match the regex /^\$?[a-z0-9_:]+$/ (no hyphens)
    const response = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_override_string: JSON.stringify({
          'auth.oauth.providers.my_provider': {
            type: 'google',
            allowSignIn: true,
            allowConnectedAccounts: true,
          },
        }),
      },
    });

    expect(response.status).toBe(200);
  });
});


describe("GET and PUT endpoints", () => {
  it("gets config override for a level", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    // Get initial config override (should be empty)
    const initialBranchResponse = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });

    expect(initialBranchResponse.status).toBe(200);
    expect(JSON.parse(initialBranchResponse.body.config_string)).toEqual({});

    // Set some config at branch level
    const patchResponse = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_override_string: JSON.stringify({
          'teams.allowClientTeamCreation': true,
        }),
      },
    });
    expect(patchResponse.status).toBe(200);

    // Get the config override again
    const updatedBranchResponse = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });

    expect(updatedBranchResponse.status).toBe(200);
    // Config is returned in flat dotted-key format
    const updatedBranchConfig = JSON.parse(updatedBranchResponse.body.config_string);
    expect(updatedBranchConfig["teams.allowClientTeamCreation"]).toBe(true);

    // Environment override should NOT have the branch-level change
    const envResponse = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });

    expect(envResponse.status).toBe(200);
    const envConfig = JSON.parse(envResponse.body.config_string);
    expect(envConfig["teams.allowClientTeamCreation"]).toBeUndefined();
  });

  it("sets config override via PUT (replaces entire config) at branch level", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    // First, PATCH some values
    const patchResponse = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_override_string: JSON.stringify({
          'teams.allowClientTeamCreation': true,
          'users.allowClientUserDeletion': true,
        }),
      },
    });
    expect(patchResponse.status).toBe(200);

    // Verify both values are set (config is in flat dotted-key format)
    const getResponse1 = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });
    const config1 = JSON.parse(getResponse1.body.config_string);
    expect(config1["teams.allowClientTeamCreation"]).toBe(true);
    expect(config1["users.allowClientUserDeletion"]).toBe(true);

    // Now PUT a completely new config (should replace, not merge)
    const putResponse = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "PUT",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_string: JSON.stringify({
          'teams.createPersonalTeamOnSignUp': true,
        }),
      },
    });
    expect(putResponse.status).toBe(200);

    // Verify the old values are gone and only the new value remains
    const getResponse2 = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });
    const config2 = JSON.parse(getResponse2.body.config_string);
    expect(config2["teams.allowClientTeamCreation"]).toBeUndefined();
    expect(config2["users.allowClientUserDeletion"]).toBeUndefined();
    expect(config2["teams.createPersonalTeamOnSignUp"]).toBe(true);
  });

  it("sets config override via PUT at environment level", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    // First, PATCH some values at environment level
    const patchResponse = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_override_string: JSON.stringify({
          'teams.allowClientTeamCreation': true,
          'users.allowClientUserDeletion': true,
        }),
      },
    });
    expect(patchResponse.status).toBe(200);

    // Now PUT a completely new config (should replace, not merge)
    const putResponse = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PUT",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_string: JSON.stringify({
          'auth.passkey.allowSignIn': true,
        }),
      },
    });
    expect(putResponse.status).toBe(200);

    // Verify the old values are gone and only the new value remains
    const getResponse = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });
    const config = JSON.parse(getResponse.body.config_string);
    expect(config["teams.allowClientTeamCreation"]).toBeUndefined();
    expect(config["users.allowClientUserDeletion"]).toBeUndefined();
    expect(config["auth.passkey.allowSignIn"]).toBe(true);
  });
});


describe("pushConfig and updateConfig behavior", () => {
  it("pushConfig overwrites previous pushConfig but retains updateConfig changes", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    // First, use updateConfig to set an environment-level value
    const updateResponse = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_override_string: JSON.stringify({
          'users.allowClientUserDeletion': true,
        }),
      },
    });
    expect(updateResponse.status).toBe(200);

    // Push a config to branch level
    const pushResponse1 = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "PUT",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_string: JSON.stringify({
          'teams.allowClientTeamCreation': true,
          'teams.createPersonalTeamOnSignUp': true,
        }),
      },
    });
    expect(pushResponse1.status).toBe(200);

    // Verify both branch and environment changes are reflected in rendered config
    const configResponse1 = await niceBackendFetch("/api/v1/internal/config", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });
    const config1 = JSON.parse(configResponse1.body.config_string);
    expect(config1.teams.allowClientTeamCreation).toBe(true);
    expect(config1.teams.createPersonalTeamOnSignUp).toBe(true);
    expect(config1.users.allowClientUserDeletion).toBe(true);

    // Push a completely new config (should overwrite branch but not environment)
    const pushResponse2 = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "PUT",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_string: JSON.stringify({
          'auth.passkey.allowSignIn': true,
        }),
      },
    });
    expect(pushResponse2.status).toBe(200);

    // Verify old branch values are gone, new branch value is set, environment value is retained
    const configResponse2 = await niceBackendFetch("/api/v1/internal/config", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });
    const config2 = JSON.parse(configResponse2.body.config_string);
    expect(config2.teams.allowClientTeamCreation).toBe(false); // back to default
    expect(config2.teams.createPersonalTeamOnSignUp).toBe(false); // back to default
    expect(config2.auth.passkey.allowSignIn).toBe(true); // new pushed value
    expect(config2.users.allowClientUserDeletion).toBe(true); // environment value retained
  });

  it("updateConfig changes take precedence over pushConfig", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    // Push a config at branch level
    const pushResponse = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "PUT",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_string: JSON.stringify({
          'teams.allowClientTeamCreation': true,
        }),
      },
    });
    expect(pushResponse.status).toBe(200);

    // Verify branch value is applied
    const configResponse1 = await niceBackendFetch("/api/v1/internal/config", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });
    const config1 = JSON.parse(configResponse1.body.config_string);
    expect(config1.teams.allowClientTeamCreation).toBe(true);

    // Use updateConfig to override the same value at environment level
    const updateResponse = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PATCH",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
      body: {
        config_override_string: JSON.stringify({
          'teams.allowClientTeamCreation': false,
        }),
      },
    });
    expect(updateResponse.status).toBe(200);

    // Verify environment value takes precedence
    const configResponse2 = await niceBackendFetch("/api/v1/internal/config", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });
    const config2 = JSON.parse(configResponse2.body.config_string);
    expect(config2.teams.allowClientTeamCreation).toBe(false);
  });
});


describe("test helpers", () => {
  it("Project.updateConfig helper sets environment level config", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    // Use the helper to update config
    await Project.updateConfig({
      'teams.allowClientTeamCreation': true,
      'users.allowClientUserDeletion': true,
    });

    // Verify environment config is set
    const envResponse = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });
    const envConfig = JSON.parse(envResponse.body.config_string);
    expect(envConfig["teams.allowClientTeamCreation"]).toBe(true);
    expect(envConfig["users.allowClientUserDeletion"]).toBe(true);

    // Update again to verify it merges (not replaces)
    await Project.updateConfig({
      'auth.passkey.allowSignIn': true,
    });

    const envResponse2 = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });
    const envConfig2 = JSON.parse(envResponse2.body.config_string);
    // Previous values should still be there
    expect(envConfig2["teams.allowClientTeamCreation"]).toBe(true);
    expect(envConfig2["users.allowClientUserDeletion"]).toBe(true);
    // New value should be added
    expect(envConfig2["auth.passkey.allowSignIn"]).toBe(true);
  });

  it("Project.pushConfig helper sets branch level config", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch();

    // Use the helper to push config
    await Project.pushConfig({
      'teams.allowClientTeamCreation': true,
      'teams.createPersonalTeamOnSignUp': true,
    });

    // Verify branch config is set
    const branchResponse = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });
    const branchConfig = JSON.parse(branchResponse.body.config_string);
    expect(branchConfig["teams.allowClientTeamCreation"]).toBe(true);
    expect(branchConfig["teams.createPersonalTeamOnSignUp"]).toBe(true);

    // Push again to verify it replaces (not merges)
    await Project.pushConfig({
      'auth.passkey.allowSignIn': true,
    });

    const branchResponse2 = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "GET",
      accessType: "admin",
      headers: adminHeaders(adminAccessToken),
    });
    const branchConfig2 = JSON.parse(branchResponse2.body.config_string);
    expect(branchConfig2["teams.allowClientTeamCreation"]).toBeUndefined();
    expect(branchConfig2["auth.passkey.allowSignIn"]).toBe(true);
  });
});
