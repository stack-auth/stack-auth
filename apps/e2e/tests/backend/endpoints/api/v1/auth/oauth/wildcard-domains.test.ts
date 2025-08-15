import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { Auth, InternalApiKey, Project, niceBackendFetch } from "../../../../../backend-helpers";
import { parseJson, stringifyJson } from "@stackframe/stack-shared/dist/utils/json";

describe("OAuth with wildcard domains", () => {
  it("should work with exact domain configuration", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch({
      config: {
        oauth_providers: [{ id: "spotify", type: "shared" }],
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    // Add exact domain matching our test redirect URL
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      body: {
        config_override_string: stringifyJson({
          'domains.trustedDomains.exact': {
            baseUrl: 'http://localhost:8107',
            handlerPath: '/handler',
          },
          'domains.allowLocalhost': false,
        }),
      },
    });
    expect(configResponse.status).toBe(200);

    // OAuth flow should work
    const response = await Auth.OAuth.signIn();
    expect(response.tokenResponse.status).toBe(200);
  });

  it("should FAIL with exact domain that doesn't match", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch({
      config: {
        oauth_providers: [{ id: "spotify", type: "shared" }],
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    // Add exact domain that DOESN'T match our test redirect URL
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      body: {
        config_override_string: stringifyJson({
          'domains.trustedDomains.exact': {
            baseUrl: 'https://app.example.com',
            handlerPath: '/handler',
          },
          'domains.allowLocalhost': false, // Disable localhost to ensure exact matching
        }),
      },
    });
    expect(configResponse.status).toBe(200);

    // Try to complete the OAuth flow - it should fail at the callback stage
    const { response } = await Auth.OAuth.getMaybeFailingAuthorizationCode();
    expect(response.status).toBe(400);
    expect(response.body).toBe("Invalid redirect URI. The URL you are trying to redirect to is not trusted. If it should be, add it to the list of trusted domains in the Stack Auth dashboard.");
  });

  it("should work with single wildcard domain", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch({
      config: {
        oauth_providers: [{ id: "spotify", type: "shared" }],
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    // Add wildcard domain
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      body: {
        config_override_string: stringifyJson({
          'domains.trustedDomains.wildcard': {
            baseUrl: 'http://*.localhost:8107',
            handlerPath: '/handler',
          },
          'domains.allowLocalhost': false,
        }),
      },
    });
    expect(configResponse.status).toBe(200);

    // OAuth flow should work with localhost
    const response = await Auth.OAuth.signIn();
    expect(response.tokenResponse.status).toBe(200);
  });

  it("should FAIL with single wildcard that doesn't match", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch({
      config: {
        oauth_providers: [{ id: "spotify", type: "shared" }],
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    // Add wildcard domain that doesn't match localhost pattern
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      body: {
        config_override_string: stringifyJson({
          'domains.trustedDomains.wildcard': {
            baseUrl: 'https://*.example.com',
            handlerPath: '/handler',
          },
          'domains.allowLocalhost': false,
        }),
      },
    });
    expect(configResponse.status).toBe(200);

    // Try to complete the OAuth flow - it should fail at the callback stage
    const { response } = await Auth.OAuth.getMaybeFailingAuthorizationCode();
    expect(response.status).toBe(400);
    expect(response.body).toBe("Invalid redirect URI. The URL you are trying to redirect to is not trusted. If it should be, add it to the list of trusted domains in the Stack Auth dashboard.");
  });

  it("should work with double wildcard domain", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch({
      config: {
        oauth_providers: [{ id: "spotify", type: "shared" }],
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    // Add double wildcard domain
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      body: {
        config_override_string: stringifyJson({
          'domains.trustedDomains.double': {
            baseUrl: 'http://**.localhost:8107',
            handlerPath: '/handler',
          },
          'domains.allowLocalhost': false,
        }),
      },
    });
    expect(configResponse.status).toBe(200);

    // OAuth flow should work
    const response = await Auth.OAuth.signIn();
    expect(response.tokenResponse.status).toBe(200);
  });

  it("should FAIL with double wildcard that doesn't match", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch({
      config: {
        oauth_providers: [{ id: "spotify", type: "shared" }],
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    // Add double wildcard for different TLD
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      body: {
        config_override_string: stringifyJson({
          'domains.trustedDomains.double': {
            baseUrl: 'https://**.example.org', // Different TLD - won't match localhost
            handlerPath: '/handler',
          },
          'domains.allowLocalhost': false,
        }),
      },
    });
    expect(configResponse.status).toBe(200);

    // Try to complete the OAuth flow - it should fail at the callback stage
    const { response } = await Auth.OAuth.getMaybeFailingAuthorizationCode();
    expect(response.status).toBe(400);
    expect(response.body).toBe("Invalid redirect URI. The URL you are trying to redirect to is not trusted. If it should be, add it to the list of trusted domains in the Stack Auth dashboard.");
  });

  it("should match prefix wildcard patterns correctly", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch({
      config: {
        oauth_providers: [{ id: "spotify", type: "shared" }],
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    // Add prefix wildcard that should match "localhost"
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      body: {
        config_override_string: stringifyJson({
          'domains.trustedDomains.prefix': {
            baseUrl: 'http://local*:8107', // Should match localhost
            handlerPath: '/handler',
          },
          'domains.allowLocalhost': false,
        }),
      },
    });
    expect(configResponse.status).toBe(200);

    // OAuth flow should work
    const response = await Auth.OAuth.signIn();
    expect(response.tokenResponse.status).toBe(200);
  });

  it("should FAIL with prefix wildcard that doesn't match", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch({
      config: {
        oauth_providers: [{ id: "spotify", type: "shared" }],
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    // Add prefix wildcard that won't match localhost
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      body: {
        config_override_string: stringifyJson({
          'domains.trustedDomains.prefix': {
            baseUrl: 'http://api-*:8107', // Won't match localhost
            handlerPath: '/handler',
          },
          'domains.allowLocalhost': false,
        }),
      },
    });
    expect(configResponse.status).toBe(200);

    // Try to complete the OAuth flow - it should fail at the callback stage
    const { response } = await Auth.OAuth.getMaybeFailingAuthorizationCode();
    expect(response.status).toBe(400);
    expect(response.body).toBe("Invalid redirect URI. The URL you are trying to redirect to is not trusted. If it should be, add it to the list of trusted domains in the Stack Auth dashboard.");
  });

  it("should properly validate multiple domains with wildcards", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch({
      config: {
        oauth_providers: [{ id: "spotify", type: "shared" }],
      }
    });
    await InternalApiKey.createAndSetProjectKeys();
    // Configure multiple domains, only one matches
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      body: {
        config_override_string: stringifyJson({
          'domains.trustedDomains.prod': {
            baseUrl: 'https://app.production.com',
            handlerPath: '/handler',
          },
          'domains.trustedDomains.staging': {
            baseUrl: 'https://*.staging.com',
            handlerPath: '/handler',
          },
          'domains.trustedDomains.test': {
            baseUrl: 'http://localhost:8107', // This one matches!
            handlerPath: '/handler',
          },
          'domains.allowLocalhost': false,
        }),
      },
    });
    expect(configResponse.status).toBe(200);

    // Get the config to verify all domains are stored
    const getResponse = await niceBackendFetch("/api/v1/internal/config", {
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      method: "GET",
    });
    expect(getResponse.status).toBe(200);

    const config = parseJson(getResponse.body.config_string);
    expect(Object.keys(config.domains.trustedDomains).length).toBe(3);
  });
});
