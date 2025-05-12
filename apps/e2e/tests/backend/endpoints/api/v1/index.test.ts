import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { describe } from "vitest";
import { it } from "../../../../helpers";
import { InternalApiKey, InternalProjectKeys, Project, backendContext, niceBackendFetch } from "../../../backend-helpers";

describe("without project ID", () => {
  backendContext.set({
    projectKeys: "no-project",
  });

  it("should load", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1");
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": deindent\`
          Welcome to the Stack API endpoint! Please refer to the documentation at https://docs.stack-auth.com.
          
          Authentication: None
        \`,
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });

  it("should fail when given extra query parameters", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1?extra=param");
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": {
          "code": "SCHEMA_ERROR",
          "details": {
            "message": deindent\`
              Request validation failed on GET /api/v1:
                - query contains unknown properties: extra
            \`,
          },
          "error": deindent\`
            Request validation failed on GET /api/v1:
              - query contains unknown properties: extra
          \`,
        },
        "headers": Headers {
          "x-stack-known-error": "SCHEMA_ERROR",
          <some fields may have been hidden>,
        },
      }
    `);
  });

  it("should not have client access", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1", {
      accessType: "client",
    });
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

  it.todo("should not be able to authenticate as user");
});

describe("with project keys that don't exist", async () => {
  backendContext.set({
    projectKeys: {
      projectId: "internal",
      publishableClientKey: "publish-key",
      secretServerKey: "secret-key",
      superSecretAdminKey: "admin-key",
    }
  });

  it("should not have client access", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1", {
      accessType: "client",
    });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 401,
        "body": {
          "code": "INVALID_PUBLISHABLE_CLIENT_KEY",
          "details": { "project_id": "internal" },
          "error": "The publishable key is not valid for the project \\"internal\\". Does the project and/or the key exist?",
        },
        "headers": Headers {
          "x-stack-known-error": "INVALID_PUBLISHABLE_CLIENT_KEY",
          <some fields may have been hidden>,
        },
      }
    `);
  });
});

describe("with project keys that don't match the project ID", async () => {
  const init = async () => {
    const getProjectKeys = () => {
      if (backendContext.value.projectKeys === "no-project") {
        throw new StackAssertionError("No project keys were set.");
      } else {
        return backendContext.value.projectKeys;
      }
    };

    const originalId = getProjectKeys().projectId;
    await Project.createAndSwitch();
    const apiKeysResult = await InternalApiKey.create();

    backendContext.set({
      projectKeys: {
        projectId: originalId,
        publishableClientKey: apiKeysResult.projectKeys.publishableClientKey,
        secretServerKey: apiKeysResult.projectKeys.secretServerKey,
        superSecretAdminKey: apiKeysResult.projectKeys.superSecretAdminKey,
      }
    });
  };

  it("should not have client access", async ({ expect }) => {
    await init();
    const response = await niceBackendFetch("/api/v1", {
      accessType: "client",
    });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 401,
        "body": {
          "code": "INVALID_PUBLISHABLE_CLIENT_KEY",
          "details": { "project_id": "internal" },
          "error": "The publishable key is not valid for the project \\"internal\\". Does the project and/or the key exist?",
        },
        "headers": Headers {
          "x-stack-known-error": "INVALID_PUBLISHABLE_CLIENT_KEY",
          <some fields may have been hidden>,
        },
      }
    `);
  });
});

describe("with internal project ID", async () => {
  backendContext.set({ projectKeys: InternalProjectKeys });

  it("should not have server access without server API key", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1", {
      accessType: "server",
      headers: {
        "x-stack-secret-server-key": "",
      },
    });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 401,
        "body": {
          "code": "SERVER_AUTHENTICATION_REQUIRED",
          "error": "The secret server key must be provided.",
        },
        "headers": Headers {
          "x-stack-known-error": "SERVER_AUTHENTICATION_REQUIRED",
          <some fields may have been hidden>,
        },
      }
    `);
  });

  it.todo("should not be able to authenticate as user without client API key");

  describe("with API keys", () => {
    it("should have client access", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v1", {
        accessType: "client",
      });
      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 200,
          "body": deindent\`
            Welcome to the Stack API endpoint! Please refer to the documentation at https://docs.stack-auth.com.
            
            Authentication: Client
              Project: internal
              User: None
          \`,
          "headers": Headers { <some fields may have been hidden> },
        }
      `);
    });

    it("should have server access", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v1", {
        accessType: "server",
      });
      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 200,
          "body": deindent\`
            Welcome to the Stack API endpoint! Please refer to the documentation at https://docs.stack-auth.com.
            
            Authentication: Server
              Project: internal
              User: None
          \`,
          "headers": Headers { <some fields may have been hidden> },
        }
      `);
    });

    it("should have admin access", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v1", {
        accessType: "admin",
      });
      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 200,
          "body": deindent\`
            Welcome to the Stack API endpoint! Please refer to the documentation at https://docs.stack-auth.com.
            
            Authentication: Admin
              Project: internal
              User: None
          \`,
          "headers": Headers { <some fields may have been hidden> },
        }
      `);
    });

    it.todo("should be able to authenticate as user");
  });

  describe("with admin API key", () => {
    it.todo("should have client access");

    it.todo("should have admin access");
  });
});
