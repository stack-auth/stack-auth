import { describe } from "vitest";
import { it } from "../../../../../../../helpers";
import { Project, backendContext, niceBackendFetch } from "../../../../../../backend-helpers";

describe("GET /api/v1/internal/payments/stripe/account-info", () => {
  describe("without project access", () => {
    backendContext.set({
      projectKeys: 'no-project'
    });

    it("should not have access to stripe account info", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v1/internal/payments/stripe/account-info", {
        accessType: "client"
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
    it("should not have access to stripe account info", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v1/internal/payments/stripe/account-info", {
        accessType: "client"
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
    it("should not have access to stripe account info", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v1/internal/payments/stripe/account-info", {
        accessType: "server"
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
    it("should throw error when no stripe account is configured", async ({ expect }) => {
      await Project.createAndSwitch({
        display_name: "Test Project Without Stripe"
      });

      const response = await niceBackendFetch("/api/v1/internal/payments/stripe/account-info", {
        accessType: "admin"
      });

      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 404,
          "body": {
            "code": "STRIPE_ACCOUNT_INFO_NOT_FOUND",
            "error": "Stripe account information not found. Please make sure the user has onboarded with Stripe.",
          },
          "headers": Headers {
            "x-stack-known-error": "STRIPE_ACCOUNT_INFO_NOT_FOUND",
            <some fields may have been hidden>,
          },
        }
      `);
    });

    it("should return stripe account info when account is configured", async ({ expect }) => {
      await Project.createAndSwitch({
        display_name: "Test Project Without Stripe"
      });


      const setupResponse = await niceBackendFetch("/api/v1/internal/payments/setup", {
        accessType: "admin",
        method: "POST"
      });
      expect(setupResponse.status).toBe(200);

      const response = await niceBackendFetch("/api/v1/internal/payments/stripe/account-info", {
        accessType: "admin"
      });

      expect(response.status).toBe(200);
      const stripped = { ...response.body, account_id: "<stripped account_id>" };
      expect(stripped).toMatchInlineSnapshot(`
        {
          "account_id": "<stripped account_id>",
          "charges_enabled": false,
          "details_submitted": false,
          "payouts_enabled": false,
        }
      `);

    });

    it("should not allow access without authentication", async ({ expect }) => {
      const result = await Project.createAndSwitch({
        display_name: "Test Project for Auth Check"
      });

      const response = await niceBackendFetch("/api/v1/internal/payments/stripe/account-info", {
        accessType: "admin"
      });

      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 404,
          "body": {
            "code": "STRIPE_ACCOUNT_INFO_NOT_FOUND",
            "error": "Stripe account information not found. Please make sure the user has onboarded with Stripe.",
          },
          "headers": Headers {
            "x-stack-known-error": "STRIPE_ACCOUNT_INFO_NOT_FOUND",
            <some fields may have been hidden>,
          },
        }
      `);
    });
  });
});
