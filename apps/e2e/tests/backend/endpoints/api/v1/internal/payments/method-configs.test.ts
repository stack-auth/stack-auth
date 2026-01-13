import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { Payments, Project, backendContext, niceBackendFetch } from "../../../../../backend-helpers";

describe("GET /api/v1/internal/payments/method-configs", () => {
  describe("without project access", () => {
    backendContext.set({
      projectKeys: 'no-project'
    });

    it("should not have access to method configs", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v1/internal/payments/method-configs", {
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
    it("should not have access to method configs", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v1/internal/payments/method-configs", {
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
    it("should not have access to method configs", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v1/internal/payments/method-configs", {
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
    it("should return error when no stripe account is configured", async ({ expect }) => {
      await Project.createAndSwitch({
        display_name: "Test Project Without Stripe"
      });

      const response = await niceBackendFetch("/api/v1/internal/payments/method-configs", {
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

    it("should return method configs when stripe account is configured", async ({ expect }) => {
      await Project.createAndSwitch();
      await Payments.setup();

      const response = await niceBackendFetch("/api/v1/internal/payments/method-configs", {
        accessType: "admin"
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("config_id");
      expect(response.body).toHaveProperty("methods");
      expect(Array.isArray(response.body.methods)).toBe(true);
    });

    it("should only return methods with valid display names", async ({ expect }) => {
      await Project.createAndSwitch();
      await Payments.setup();

      const response = await niceBackendFetch("/api/v1/internal/payments/method-configs", {
        accessType: "admin"
      });

      expect(response.status).toBe(200);

      for (const method of response.body.methods as { id: string, name: string, enabled: boolean, available: boolean, overridable: boolean }[]) {
        expect(method).toHaveProperty("id");
        expect(method).toHaveProperty("name");
        expect(method).toHaveProperty("enabled");
        expect(method).toHaveProperty("available");
        expect(method).toHaveProperty("overridable");
        expect(typeof method.id).toBe("string");
        expect(typeof method.name).toBe("string");
        expect(typeof method.enabled).toBe("boolean");
        expect(typeof method.available).toBe("boolean");
        expect(typeof method.overridable).toBe("boolean");
      }
    });

    it("should isolate payment method configs between different projects", async ({ expect }) => {
      const projectA = await Project.createAndSwitch({ display_name: "Project A" });
      await Payments.setup();

      const projectAConfigResponse = await niceBackendFetch("/api/v1/internal/payments/method-configs", {
        accessType: "admin"
      });
      expect(projectAConfigResponse.status).toBe(200);
      const projectAConfigId = projectAConfigResponse.body.config_id;

      const updateResponse = await niceBackendFetch("/api/v1/internal/payments/method-configs", {
        method: "PATCH",
        accessType: "admin",
        body: {
          config_id: projectAConfigId,
          updates: {
            "link": "off"
          }
        }
      });
      expect(updateResponse.status).toBe(200);

      await Project.createAndSwitch({ display_name: "Project B" });
      await Payments.setup();

      const projectBConfigResponse = await niceBackendFetch("/api/v1/internal/payments/method-configs", {
        accessType: "admin"
      });
      expect(projectBConfigResponse.status).toBe(200);

      expect(projectBConfigResponse.body.config_id).not.toBe(projectAConfigId);

      backendContext.set({
        projectKeys: {
          projectId: projectA.projectId,
          adminAccessToken: projectA.adminAccessToken,
        },
        userAuth: null
      });

      const projectAConfigAfterResponse = await niceBackendFetch("/api/v1/internal/payments/method-configs", {
        accessType: "admin"
      });
      expect(projectAConfigAfterResponse.status).toBe(200);
      expect(projectAConfigAfterResponse.body.config_id).toBe(projectAConfigId);
    });
  });
});

describe("PATCH /api/v1/internal/payments/method-configs", () => {
  describe("with client access", () => {
    it("should not have access to update method configs", async ({ expect }) => {
      const response = await niceBackendFetch("/api/v1/internal/payments/method-configs", {
        method: "PATCH",
        accessType: "client",
        body: {
          config_id: "test",
          updates: {}
        }
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

  describe("with admin access", () => {
    it("should reject invalid payment method IDs", async ({ expect }) => {
      await Project.createAndSwitch();
      await Payments.setup();

      const response = await niceBackendFetch("/api/v1/internal/payments/method-configs", {
        method: "PATCH",
        accessType: "admin",
        body: {
          config_id: "pmc_test",
          updates: {
            "invalid_method": "on"
          }
        }
      });

      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 400,
          "body": {
            "code": "SCHEMA_ERROR",
            "details": {
              "message": deindent\`
                Request validation failed on PATCH /api/v1/internal/payments/method-configs:
                  - body.updates must be one of the following values: card, apple_pay, google_pay, klarna, affirm, afterpay_clearpay, alipay, amazon_pay, link, cashapp, acss_debit, bacs_debit, bancontact, blik, cartes_bancaires, customer_balance, eps, giropay, ideal, multibanco, p24, sepa_debit, sofort, us_bank_account, wechat_pay, zip
              \`,
            },
            "error": deindent\`
              Request validation failed on PATCH /api/v1/internal/payments/method-configs:
                - body.updates must be one of the following values: card, apple_pay, google_pay, klarna, affirm, afterpay_clearpay, alipay, amazon_pay, link, cashapp, acss_debit, bacs_debit, bancontact, blik, cartes_bancaires, customer_balance, eps, giropay, ideal, multibanco, p24, sepa_debit, sofort, us_bank_account, wechat_pay, zip
            \`,
          },
          "headers": Headers {
            "x-stack-known-error": "SCHEMA_ERROR",
            <some fields may have been hidden>,
          },
        }
      `);
    });

    it("should reject invalid preference values", async ({ expect }) => {
      await Project.createAndSwitch();
      await Payments.setup();

      const response = await niceBackendFetch("/api/v1/internal/payments/method-configs", {
        method: "PATCH",
        accessType: "admin",
        body: {
          config_id: "pmc_test",
          updates: {
            "card": "enabled"
          }
        }
      });

      expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 400,
          "body": {
            "code": "SCHEMA_ERROR",
            "details": {
              "message": deindent\`
                Request validation failed on PATCH /api/v1/internal/payments/method-configs:
                  - body.updates must be one of the following values: on, off
              \`,
            },
            "error": deindent\`
              Request validation failed on PATCH /api/v1/internal/payments/method-configs:
                - body.updates must be one of the following values: on, off
            \`,
          },
          "headers": Headers {
            "x-stack-known-error": "SCHEMA_ERROR",
            <some fields may have been hidden>,
          },
        }
      `);
    });

    it("should successfully update valid payment method configs", async ({ expect }) => {
      await Project.createAndSwitch();
      await Payments.setup();

      const getResponse = await niceBackendFetch("/api/v1/internal/payments/method-configs", {
        accessType: "admin"
      });
      expect(getResponse.status).toBe(200);
      const configId = getResponse.body.config_id;

      const patchResponse = await niceBackendFetch("/api/v1/internal/payments/method-configs", {
        method: "PATCH",
        accessType: "admin",
        body: {
          config_id: configId,
          updates: {
            "card": "on"
          }
        }
      });

      expect(patchResponse.status).toBe(200);
      expect(patchResponse.body).toEqual({ success: true });
    });
  });
});
