import { describe } from "vitest";
import { it, localRedirectUrl } from "../../../../../../helpers";
import { Auth, InternalApiKey, Project, niceBackendFetch } from "../../../../../backend-helpers";

describe("OAuth with exact domain matching", () => {
  it("should allow OAuth with exact matching domain", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch({
      config: {
        oauth_providers: [{ id: "spotify", type: "shared" }],
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    // Add exact domain that matches our redirect URL
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      body: {
        config_override_string: JSON.stringify({
          'domains.trustedDomains.exact': {
            baseUrl: 'http://localhost:8107',
            handlerPath: '/handler',
          },
          'domains.allowLocalhost': true,
        }),
      },
    });
    expect(configResponse.status).toBe(200);

    // OAuth flow should succeed
    const response = await Auth.OAuth.signIn();
    expect(response.tokenResponse.status).toBe(200);
    await Auth.expectToBeSignedIn();
  });

  it("should reject OAuth with non-matching exact domain", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch({
      config: {
        oauth_providers: [{ id: "spotify", type: "shared" }],
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    // Add exact domain that does NOT match
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      body: {
        config_override_string: JSON.stringify({
          'domains.trustedDomains.production': {
            baseUrl: 'https://app.production.com',
            handlerPath: '/auth/handler',
          },
          'domains.allowLocalhost': false, // Ensure we only check exact domains
        }),
      },
    });
    expect(configResponse.status).toBe(200);

    // Try to complete the OAuth flow - it should fail at the callback stage
    const { response } = await Auth.OAuth.getMaybeFailingAuthorizationCode();
    expect(response.status).toBe(400);
    expect(response.body).toBe("Invalid redirect URI. The URL you are trying to redirect to is not trusted. If it should be, add it to the list of trusted domains in the Stack Auth dashboard.");
  });

  it("should match exact subdomain but not other subdomains", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch({
      config: {
        oauth_providers: [{ id: "spotify", type: "shared" }],
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    // Add exact subdomain
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      body: {
        config_override_string: JSON.stringify({
          'domains.trustedDomains.subdomain': {
            baseUrl: 'https://app.example.com',
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

  it("should require exact port matching", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch({
      config: {
        oauth_providers: [{ id: "spotify", type: "shared" }],
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    // Add domain with specific port
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      body: {
        config_override_string: JSON.stringify({
          'domains.trustedDomains.withport': {
            baseUrl: 'http://localhost:3000',
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

  it("should require exact protocol matching", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch({
      config: {
        oauth_providers: [{ id: "spotify", type: "shared" }],
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    // Add HTTPS domain
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      body: {
        config_override_string: JSON.stringify({
          'domains.trustedDomains.https': {
            baseUrl: 'https://localhost:8107',
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

  it("should match path prefix correctly", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch({
      config: {
        oauth_providers: [{ id: "spotify", type: "shared" }],
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    // Add domain with specific handler path
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      body: {
        config_override_string: JSON.stringify({
          'domains.trustedDomains.withpath': {
            baseUrl: 'http://localhost:8107',
            handlerPath: '/auth/oauth/callback', // Different path than default /handler
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

  it("should work with multiple exact domains where one matches", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch({
      config: {
        oauth_providers: [{ id: "spotify", type: "shared" }],
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    // Add multiple domains
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      body: {
        config_override_string: JSON.stringify({
          'domains.trustedDomains.prod': {
            baseUrl: 'https://app.production.com',
            handlerPath: '/handler',
          },
          'domains.trustedDomains.staging': {
            baseUrl: 'https://app.staging.com',
            handlerPath: '/handler',
          },
          'domains.trustedDomains.local': {
            baseUrl: 'http://localhost:8107', // This one matches!
            handlerPath: '/handler',
          },
          'domains.allowLocalhost': true,
        }),
      },
    });
    expect(configResponse.status).toBe(200);

    // OAuth should succeed with the matching domain
    const response = await Auth.OAuth.signIn();
    expect(response.tokenResponse.status).toBe(200);
  });

  it("should fail when no exact domains match", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch({
      config: {
        oauth_providers: [{ id: "spotify", type: "shared" }],
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    // Add multiple domains, none match localhost:8107
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      body: {
        config_override_string: JSON.stringify({
          'domains.trustedDomains.prod': {
            baseUrl: 'https://app.production.com',
            handlerPath: '/handler',
          },
          'domains.trustedDomains.staging': {
            baseUrl: 'https://app.staging.com',
            handlerPath: '/handler',
          },
          'domains.trustedDomains.differentPort': {
            baseUrl: 'http://localhost:3000', // Different port
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
});
