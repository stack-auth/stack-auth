import { describe } from "vitest";
import { it } from "../../../../../../../helpers";
import { InternalApiKey, Project, niceBackendFetch } from "../../../../../../backend-helpers";

describe("Native Apple Sign In", () => {
  it("should return error when Apple OAuth is not enabled", async ({ expect }) => {
    // Create project without Apple OAuth
    await Project.createAndSwitch({
      config: {
        oauth_providers: [{ id: "google", type: "shared" }],
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    const response = await niceBackendFetch("/api/v1/auth/oauth/callback/apple/native", {
      method: "POST",
      accessType: "client",
      body: {
        id_token: "fake-token",
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchInlineSnapshot(`
      {
        "code": "OAUTH_PROVIDER_NOT_FOUND_OR_NOT_ENABLED",
        "error": "The OAuth provider is not found or not enabled.",
      }
    `);
  });

  it("should return error when Apple Bundle ID is not configured", async ({ expect }) => {
    // Create project with Apple OAuth but no Bundle ID
    await Project.createAndSwitch({
      config: {
        oauth_providers: [{
          id: "apple",
          type: "standard",
          client_id: "com.example.web.service", // Services ID for web
          client_secret: "test-secret",
          // Note: No apple_bundle_ids configured
        }],
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    const response = await niceBackendFetch("/api/v1/auth/oauth/callback/apple/native", {
      method: "POST",
      accessType: "client",
      body: {
        id_token: "fake-token",
      },
    });

    // Should fail because appleBundleIds is not configured (provider not properly configured for native)
    expect(response.status).toBe(400);
    expect(response.body).toMatchInlineSnapshot(`
      {
        "code": "OAUTH_PROVIDER_NOT_FOUND_OR_NOT_ENABLED",
        "error": "The OAuth provider is not found or not enabled.",
      }
    `);
  });

  it("should return error for invalid Apple identity token", async ({ expect }) => {
    // Create project with Apple OAuth and Bundle ID
    await Project.createAndSwitch({
      config: {
        oauth_providers: [{
          id: "apple",
          type: "standard",
          client_id: "com.example.web.service",
          client_secret: "test-secret",
          apple_bundle_ids: ["com.example.ios.app"],
        }],
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    const response = await niceBackendFetch("/api/v1/auth/oauth/callback/apple/native", {
      method: "POST",
      accessType: "client",
      body: {
        id_token: "invalid-jwt-token",
      },
    });

    // Should fail JWT verification
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_ID_TOKEN");
  });

  it("should reject requests with missing id_token", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        oauth_providers: [{
          id: "apple",
          type: "standard",
          client_id: "com.example.web.service",
          client_secret: "test-secret",
          apple_bundle_ids: ["com.example.ios.app"],
        }],
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    const response = await niceBackendFetch("/api/v1/auth/oauth/callback/apple/native", {
      method: "POST",
      accessType: "client",
      body: {},
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("SCHEMA_ERROR");
  });
});
