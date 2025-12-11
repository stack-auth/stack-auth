import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { niceBackendFetch } from "../../../../backend-helpers";

describe("GET /api/v1/internal/email-queue-step", () => {
  it("should return error when no authorization header is provided", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/internal/email-queue-step", {
      method: "GET",
    });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": {
          "code": "SCHEMA_ERROR",
          "details": {
            "message": deindent\`
              Request validation failed on GET /api/v1/internal/email-queue-step:
                - headers.authorization must be defined
            \`,
          },
          "error": deindent\`
            Request validation failed on GET /api/v1/internal/email-queue-step:
              - headers.authorization must be defined
          \`,
        },
        "headers": Headers {
          "x-stack-known-error": "SCHEMA_ERROR",
          <some fields may have been hidden>,
        },
      }
    `);
  });

  it("should return error when invalid authorization header is provided", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/internal/email-queue-step", {
      method: "GET",
      headers: {
        "Authorization": "Bearer invalid_secret",
      },
    });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 401,
        "body": "Unauthorized",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });

  it("should return 200 when valid authorization header is provided", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/internal/email-queue-step", {
      method: "GET",
      headers: {
        "Authorization": "Bearer mock_cron_secret",
      },
      query: {
        only_one_step: "true",
      },
    });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "ok": true },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });
});

