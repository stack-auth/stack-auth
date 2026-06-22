import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { niceBackendFetch } from "../../../../backend-helpers";

describe("GET /api/v1/internal/cleanup-anonymous-users", () => {
  it("should return error when no authorization header is provided", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/internal/cleanup-anonymous-users", {
      method: "GET",
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("SCHEMA_ERROR");
  });

  it("should return 401 when an invalid authorization header is provided", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/internal/cleanup-anonymous-users", {
      method: "GET",
      headers: { "Authorization": "Bearer invalid_secret" },
    });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 401,
        "body": "Unauthorized",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });

  it("should run and report a count when a valid CRON secret is provided", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/internal/cleanup-anonymous-users", {
      method: "GET",
      headers: { "Authorization": "Bearer mock_cron_secret" },
    });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(typeof response.body.deleted).toBe("number");
    expect(typeof response.body.tenancies_processed).toBe("number");
  });
});
