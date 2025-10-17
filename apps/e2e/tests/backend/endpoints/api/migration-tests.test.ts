import { describe } from "vitest";
import { it } from "../../../helpers";
import { niceBackendFetch } from "../../backend-helpers";

/*
- v1: This route does not yet exist; it shows a 404 error.
- v2beta1: Takes an optional query parameter 'queryParam' and displays it. If not given, it defaults to the string "n/a".
- v2beta2: The query parameter is now required.
- v2beta3: The query parameter is now called 'queryParamNew'.
- v2beta4: The query parameter is now optional again (this is not actually a breaking change, so in a real scenario we wouldn't need a new version).
*/

describe("SmartRouteHandler", () => {
  describe("v1", () => {
    it("should return a 404 error", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v1/migration-tests/smart-route-handler");
      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 404,
          "body": deindent\`
            404 — this page does not exist in Stack Auth's API.
            
            Please see the API documentation at https://docs.stack-auth.com, or visit the Stack Auth dashboard at https://app.stack-auth.com.
            
            URL: http://localhost:<$STACK_PORT_PREFIX>02/api/v1/migration-tests/smart-route-handler
          \`,
          "headers": Headers { <some fields may have been hidden> },
        }
      `);
    });
  });

  describe("v2beta1", () => {
    it("should return 200 without queryParam", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v2beta1/migration-tests/smart-route-handler");
      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 200,
          "body": deindent\`
            Welcome to the migration test route for SmartRouteHandler! This route only exists for demonstration purposes and has no practical functionality.
            
            The query parameter you passed in is: n/a
            
            Here's what it does:
            
            - v1: This route does not yet exist; it shows a 404 error.
            - v2beta1: Takes an optional query parameter 'queryParam' and displays it. If not given, it defaults to the string "n/a".
            - v2beta2: The query parameter is now required.
            - v2beta3: The query parameter is now called 'queryParamNew'.
            - v2beta4: The query parameter is now optional again (this is not actually a breaking change, so in a real scenario we wouldn't need a new version).
          \`,
          "headers": Headers { <some fields may have been hidden> },
        }
      `);
      expect(response.headers.get("x-middleware-rewrite")).toBe(`/api/migrations/v2beta2/migration-tests/smart-route-handler`);
    });

    it("should return 200 with queryParam", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v2beta1/migration-tests/smart-route-handler?queryParam=123");
      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 200,
          "body": deindent\`
            Welcome to the migration test route for SmartRouteHandler! This route only exists for demonstration purposes and has no practical functionality.
            
            The query parameter you passed in is: 123
            
            Here's what it does:
            
            - v1: This route does not yet exist; it shows a 404 error.
            - v2beta1: Takes an optional query parameter 'queryParam' and displays it. If not given, it defaults to the string "n/a".
            - v2beta2: The query parameter is now required.
            - v2beta3: The query parameter is now called 'queryParamNew'.
            - v2beta4: The query parameter is now optional again (this is not actually a breaking change, so in a real scenario we wouldn't need a new version).
          \`,
          "headers": Headers { <some fields may have been hidden> },
        }
      `);
    });

    it("should fail with queryParamNew", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v2beta1/migration-tests/smart-route-handler?queryParamNew=123");
      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 400,
          "body": {
            "code": "SCHEMA_ERROR",
            "details": {
              "message": deindent\`
                Request validation failed on GET /api/v2beta1/migration-tests/smart-route-handler:
                  - query contains unknown properties: queryParamNew
              \`,
            },
            "error": deindent\`
              Request validation failed on GET /api/v2beta1/migration-tests/smart-route-handler:
                - query contains unknown properties: queryParamNew
            \`,
          },
          "headers": Headers {
            "x-stack-known-error": "SCHEMA_ERROR",
            <some fields may have been hidden>,
          },
        }
      `);
    });
  });

  describe("v2beta2", () => {
    it("should return 200 with queryParam", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v2beta2/migration-tests/smart-route-handler?queryParam=123");
      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 200,
          "body": deindent\`
            Welcome to the migration test route for SmartRouteHandler! This route only exists for demonstration purposes and has no practical functionality.
            
            The query parameter you passed in is: 123
            
            Here's what it does:
            
            - v1: This route does not yet exist; it shows a 404 error.
            - v2beta1: Takes an optional query parameter 'queryParam' and displays it. If not given, it defaults to the string "n/a".
            - v2beta2: The query parameter is now required.
            - v2beta3: The query parameter is now called 'queryParamNew'.
            - v2beta4: The query parameter is now optional again (this is not actually a breaking change, so in a real scenario we wouldn't need a new version).
          \`,
          "headers": Headers { <some fields may have been hidden> },
        }
      `);
    });

    it("should fail without queryParam", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v2beta2/migration-tests/smart-route-handler");
      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 400,
          "body": {
            "code": "SCHEMA_ERROR",
            "details": {
              "message": deindent\`
                Request validation failed on GET /api/v2beta2/migration-tests/smart-route-handler:
                  - query.queryParam must be defined
              \`,
            },
            "error": deindent\`
              Request validation failed on GET /api/v2beta2/migration-tests/smart-route-handler:
                - query.queryParam must be defined
            \`,
          },
          "headers": Headers {
            "x-stack-known-error": "SCHEMA_ERROR",
            <some fields may have been hidden>,
          },
        }
      `);
    });

    it("should fail with queryParamNew", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v2beta2/migration-tests/smart-route-handler?queryParam=123&queryParamNew=123");
      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 400,
          "body": {
            "code": "SCHEMA_ERROR",
            "details": {
              "message": deindent\`
                Request validation failed on GET /api/v2beta2/migration-tests/smart-route-handler:
                  - query contains unknown properties: queryParamNew
              \`,
            },
            "error": deindent\`
              Request validation failed on GET /api/v2beta2/migration-tests/smart-route-handler:
                - query contains unknown properties: queryParamNew
            \`,
          },
          "headers": Headers {
            "x-stack-known-error": "SCHEMA_ERROR",
            <some fields may have been hidden>,
          },
        }
      `);
    });
  });

  describe("v2beta3", () => {
    it("should return 200 with queryParamNew", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v2beta3/migration-tests/smart-route-handler?queryParamNew=123");
      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 200,
          "body": deindent\`
            Welcome to the migration test route for SmartRouteHandler! This route only exists for demonstration purposes and has no practical functionality.
            
            The query parameter you passed in is: 123
            
            Here's what it does:
            
            - v1: This route does not yet exist; it shows a 404 error.
            - v2beta1: Takes an optional query parameter 'queryParam' and displays it. If not given, it defaults to the string "n/a".
            - v2beta2: The query parameter is now required.
            - v2beta3: The query parameter is now called 'queryParamNew'.
            - v2beta4: The query parameter is now optional again (this is not actually a breaking change, so in a real scenario we wouldn't need a new version).
          \`,
          "headers": Headers { <some fields may have been hidden> },
        }
      `);
    });

    it("should fail without queryParamNew", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v2beta3/migration-tests/smart-route-handler");
      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 400,
          "body": {
            "code": "SCHEMA_ERROR",
            "details": {
              "message": deindent\`
                Request validation failed on GET /api/v2beta3/migration-tests/smart-route-handler:
                  - query.queryParamNew must be defined
              \`,
            },
            "error": deindent\`
              Request validation failed on GET /api/v2beta3/migration-tests/smart-route-handler:
                - query.queryParamNew must be defined
            \`,
          },
          "headers": Headers {
            "x-stack-known-error": "SCHEMA_ERROR",
            <some fields may have been hidden>,
          },
        }
      `);
    });

    it("should fail with queryParam", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v2beta3/migration-tests/smart-route-handler?queryParam=123&queryParamNew=123");
      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 400,
          "body": {
            "code": "SCHEMA_ERROR",
            "details": {
              "message": deindent\`
                Request validation failed on GET /api/v2beta3/migration-tests/smart-route-handler:
                  - query contains unknown properties: queryParam
              \`,
            },
            "error": deindent\`
              Request validation failed on GET /api/v2beta3/migration-tests/smart-route-handler:
                - query contains unknown properties: queryParam
            \`,
          },
          "headers": Headers {
            "x-stack-known-error": "SCHEMA_ERROR",
            <some fields may have been hidden>,
          },
        }
      `);
    });
  });

  describe("v2beta4", () => {
    it("should return 200 with queryParamNew", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v2beta4/migration-tests/smart-route-handler?queryParamNew=123");
      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 200,
          "body": deindent\`
            Welcome to the migration test route for SmartRouteHandler! This route only exists for demonstration purposes and has no practical functionality.
            
            The query parameter you passed in is: 123
            
            Here's what it does:
            
            - v1: This route does not yet exist; it shows a 404 error.
            - v2beta1: Takes an optional query parameter 'queryParam' and displays it. If not given, it defaults to the string "n/a".
            - v2beta2: The query parameter is now required.
            - v2beta3: The query parameter is now called 'queryParamNew'.
            - v2beta4: The query parameter is now optional again (this is not actually a breaking change, so in a real scenario we wouldn't need a new version).
          \`,
          "headers": Headers { <some fields may have been hidden> },
        }
      `);
    });

    it("should return 200 without queryParamNew", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v2beta4/migration-tests/smart-route-handler");
      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 200,
          "body": deindent\`
            Welcome to the migration test route for SmartRouteHandler! This route only exists for demonstration purposes and has no practical functionality.
            
            Looks like you didn't pass in the query parameter. That's fine, read on below to see what this route does.
            
            Here's what it does:
            
            - v1: This route does not yet exist; it shows a 404 error.
            - v2beta1: Takes an optional query parameter 'queryParam' and displays it. If not given, it defaults to the string "n/a".
            - v2beta2: The query parameter is now required.
            - v2beta3: The query parameter is now called 'queryParamNew'.
            - v2beta4: The query parameter is now optional again (this is not actually a breaking change, so in a real scenario we wouldn't need a new version).
          \`,
          "headers": Headers { <some fields may have been hidden> },
        }
      `);
    });

    it("should fail with queryParam", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v2beta4/migration-tests/smart-route-handler?queryParam=123");
      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 400,
          "body": {
            "code": "SCHEMA_ERROR",
            "details": {
              "message": deindent\`
                Request validation failed on GET /api/v2beta4/migration-tests/smart-route-handler:
                  - query contains unknown properties: queryParam
              \`,
            },
            "error": deindent\`
              Request validation failed on GET /api/v2beta4/migration-tests/smart-route-handler:
                - query contains unknown properties: queryParam
            \`,
          },
          "headers": Headers {
            "x-stack-known-error": "SCHEMA_ERROR",
            <some fields may have been hidden>,
          },
        }
      `);
    });
  });
});
