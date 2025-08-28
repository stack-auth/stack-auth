import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { Auth, Project, backendContext, niceBackendFetch } from "../../../../../backend-helpers";

describe("POST /api/v1/internal/payments/setup", () => {
  describe("without project access", () => {
    backendContext.set({
      projectKeys: 'no-project'
    });

    it("should not have access to payment setup", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v1/internal/payments/setup", {
        method: "POST",
        accessType: "client",
        body: {}
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
  });

  describe("with client access", () => {
    it("should not have access to payment setup", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v1/internal/payments/setup", {
        method: "POST",
        accessType: "client",
        body: {}
      });
      expect(response).toMatchInlineSnapshot(`
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
    });
  });

  describe("with server access", () => {
    it("should not have access to payment setup", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v1/internal/payments/setup", {
        method: "POST",
        accessType: "server",
        body: {}
      });
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

  describe("with admin access", () => {
    it("should return a setup URL when creating new stripe account", async ({ expect }) => {
      await Auth.Otp.signIn();
      await Project.createAndSwitch();
      const response = await niceBackendFetch("/api/v1/internal/payments/setup", {
        method: "POST",
        accessType: "admin",
        body: {}
      });

      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 200,
          "body": { "url": "https://sangeekp-15t6ai--manage-mydev.dev.stripe.me/setup/s/acct_1PgafTB7WZ01zgkW/MerI6itPZo2K" },
          "headers": Headers { <some fields may have been hidden> },
        }
      `);
    });

    it("should reuse existing stripe account when already configured", async ({ expect }) => {
      await Auth.Otp.signIn();
      await Project.createAndSwitch();

      // First call to setup
      const response1 = await niceBackendFetch("/api/v1/internal/payments/setup", {
        method: "POST",
        accessType: "admin",
        body: {}
      });
      expect(response1).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 200,
          "body": { "url": "https://sangeekp-15t6ai--manage-mydev.dev.stripe.me/setup/s/acct_1PgafTB7WZ01zgkW/MerI6itPZo2K" },
          "headers": Headers { <some fields may have been hidden> },
        }
      `);

      // Second call should reuse the same account
      const response2 = await niceBackendFetch("/api/v1/internal/payments/setup", {
        method: "POST",
        accessType: "admin",
        body: {}
      });
      expect(response2).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 200,
          "body": { "url": "https://sangeekp-15t6ai--manage-mydev.dev.stripe.me/setup/s/acct_1PgafTB7WZ01zgkW/MerI6itPZo2K" },
          "headers": Headers { <some fields may have been hidden> },
        }
      `);
    });
  });
});
