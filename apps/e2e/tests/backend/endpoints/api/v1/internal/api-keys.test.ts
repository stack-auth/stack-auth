import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, InternalApiKey, Project, backendContext, niceBackendFetch } from "../../../../backend-helpers";


describe("without project access", () => {
  backendContext.set({
    projectKeys: 'no-project'
  });

  it("should not have access to api keys", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/internal/api-keys", { accessType: "client" });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": {
          "code": "ACCESS_TYPE_WITHOUT_PROJECT_ID",
          "details": { "request_type": "client" },
          "error": deindent\`
            The x-stack-access-type header was 'client', but the x-stack-project-id header was not provided.
            
            For more information, see the docs on REST API authentication: https://docs.stack-auth.com/rest-api/overview#authentication
          \`,
        },
        "headers": Headers {
          "x-stack-known-error": "ACCESS_TYPE_WITHOUT_PROJECT_ID",
          <some fields may have been hidden>,
        },
      }
    `);
  });
});

describe("with server access", () => {
  it("should not have access to api keys", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/internal/api-keys", { accessType: "server" });
    expect(response).toMatchInlineSnapshot(`
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

describe("with admin access to the internal project", () => {
  it("list api keys", async ({ expect }) => {
    await Auth.Otp.signIn();
    const response = await niceBackendFetch("/api/v1/internal/api-keys", { accessType: "admin" });
    expect(response.status).toBe(200); // not doing snapshot as it contains all the test api keys
  });

  it("creates api keys for internal project", async ({ expect }) => {
    await Auth.Otp.signIn();
    const response1 = await niceBackendFetch("/api/v1/internal/api-keys", {
      accessType: "admin",
      method: "POST",
      body: {
        description: "test api key",
        has_publishable_client_key: true,
        has_secret_server_key: true,
        has_super_secret_admin_key: true,
        expires_at_millis: 123,
      },
    });
    expect(response1).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "created_at_millis": <stripped field 'created_at_millis'>,
          "description": "test api key",
          "expires_at_millis": <stripped field 'expires_at_millis'>,
          "id": "<stripped UUID>",
          "publishable_client_key": <stripped field 'publishable_client_key'>,
          "secret_server_key": <stripped field 'secret_server_key'>,
          "super_secret_admin_key": <stripped field 'super_secret_admin_key'>,
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });
});

describe("with admin access to a non-internal project", () => {
  it("creates api keys without admin access token", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/internal/api-keys", {
      accessType: "admin",
      method: "POST",
      body: {
        description: "test api key",
        has_publishable_client_key: true,
        has_secret_server_key: true,
        has_super_secret_admin_key: true,
        expires_at_millis: 123,
      },
    });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "created_at_millis": <stripped field 'created_at_millis'>,
          "description": "test api key",
          "expires_at_millis": <stripped field 'expires_at_millis'>,
          "id": "<stripped UUID>",
          "publishable_client_key": <stripped field 'publishable_client_key'>,
          "secret_server_key": <stripped field 'secret_server_key'>,
          "super_secret_admin_key": <stripped field 'super_secret_admin_key'>,
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });

  it("creates api keys with invalid admin access token", async ({ expect }) => {
    const response1 = await niceBackendFetch("/api/v1/internal/api-keys", {
      accessType: "admin",
      method: "POST",
      body: {
        description: "test api key",
        has_publishable_client_key: true,
        has_secret_server_key: true,
        has_super_secret_admin_key: true,
        expires_at_millis: 123,
      },
      headers: {
        'x-stack-admin-access-token': 'invalid-key',
      }
    });
    expect(response1).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 401,
        "body": {
          "code": "UNPARSABLE_ADMIN_ACCESS_TOKEN",
          "error": "Admin access token is not parsable.",
        },
        "headers": Headers {
          "x-stack-known-error": "UNPARSABLE_ADMIN_ACCESS_TOKEN",
          <some fields may have been hidden>,
        },
      }
    `);
  });

  it("creates, list, updates, revokes api keys", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndGetAdminToken();
    const { createApiKeyResponse } = await InternalApiKey.create(adminAccessToken);
    expect(createApiKeyResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "created_at_millis": <stripped field 'created_at_millis'>,
          "description": "test api key",
          "expires_at_millis": <stripped field 'expires_at_millis'>,
          "id": "<stripped UUID>",
          "publishable_client_key": <stripped field 'publishable_client_key'>,
          "secret_server_key": <stripped field 'secret_server_key'>,
          "super_secret_admin_key": <stripped field 'super_secret_admin_key'>,
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // ensure the api key works
    const response1 = await niceBackendFetch(`/api/v1/users`, {
      accessType: "admin",
      headers: {
        'x-stack-super-secret-admin-key': createApiKeyResponse.body.super_secret_admin_key,
      }
    });
    expect(response1).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "is_paginated": true,
          "items": [],
          "pagination": { "next_cursor": null },
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // update api key description
    const response2 = await niceBackendFetch(`/api/v1/internal/api-keys/${createApiKeyResponse.body.id}`, {
      accessType: "admin",
      method: "PATCH",
      body: {
        description: "new description",
      },
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      }
    });

    expect(response2).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "created_at_millis": <stripped field 'created_at_millis'>,
          "description": "new description",
          "expires_at_millis": <stripped field 'expires_at_millis'>,
          "id": "<stripped UUID>",
          "publishable_client_key": { "last_four": <stripped field 'last_four'> },
          "secret_server_key": { "last_four": <stripped field 'last_four'> },
          "super_secret_admin_key": { "last_four": <stripped field 'last_four'> },
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // create another api key
    const { createApiKeyResponse: createApiKeyResponse2 } = await InternalApiKey.create(adminAccessToken, {
      description: 'key2',
      has_publishable_client_key: false,
      has_secret_server_key: true,
      has_super_secret_admin_key: false
    });
    expect(createApiKeyResponse2).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "created_at_millis": <stripped field 'created_at_millis'>,
          "description": "key2",
          "expires_at_millis": <stripped field 'expires_at_millis'>,
          "id": "<stripped UUID>",
          "secret_server_key": <stripped field 'secret_server_key'>,
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // list api keys
    const response3 = await niceBackendFetch("/api/v1/internal/api-keys", {
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      }
    });
    expect(response3).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "is_paginated": false,
          "items": [
            {
              "created_at_millis": <stripped field 'created_at_millis'>,
              "description": "key2",
              "expires_at_millis": <stripped field 'expires_at_millis'>,
              "id": "<stripped UUID>",
              "secret_server_key": { "last_four": <stripped field 'last_four'> },
            },
            {
              "created_at_millis": <stripped field 'created_at_millis'>,
              "description": "new description",
              "expires_at_millis": <stripped field 'expires_at_millis'>,
              "id": "<stripped UUID>",
              "publishable_client_key": { "last_four": <stripped field 'last_four'> },
              "secret_server_key": { "last_four": <stripped field 'last_four'> },
              "super_secret_admin_key": { "last_four": <stripped field 'last_four'> },
            },
          ],
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // revoke api key
    const response4 = await niceBackendFetch(`/api/v1/internal/api-keys/${createApiKeyResponse.body.id}`, {
      accessType: "admin",
      method: "PATCH",
      body: {
        revoked: true,
      },
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      }
    });
    expect(response4).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "created_at_millis": <stripped field 'created_at_millis'>,
          "description": "new description",
          "expires_at_millis": <stripped field 'expires_at_millis'>,
          "id": "<stripped UUID>",
          "manually_revoked_at_millis": <stripped field 'manually_revoked_at_millis'>,
          "publishable_client_key": { "last_four": <stripped field 'last_four'> },
          "secret_server_key": { "last_four": <stripped field 'last_four'> },
          "super_secret_admin_key": { "last_four": <stripped field 'last_four'> },
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // ensure the api key no longer works
    const response5 = await niceBackendFetch(`/api/v1/users`, {
      accessType: "admin",
      headers: {
        'x-stack-super-secret-admin-key': createApiKeyResponse.body.super_secret_admin_key,
      }
    });
    expect(response5).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 401,
        "body": {
          "code": "INVALID_SUPER_SECRET_ADMIN_KEY",
          "details": { "project_id": "<stripped UUID>" },
          "error": "The super secret admin key is not valid for the project \\"<stripped UUID>\\". Does the project and/or the key exist?",
        },
        "headers": Headers {
          "x-stack-known-error": "INVALID_SUPER_SECRET_ADMIN_KEY",
          <some fields may have been hidden>,
        },
      }
    `);
  });
});

describe("without admin access to a non-internal project", () => {
  it.todo("is not allowed to list api keys");
});
