import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { niceBackendFetch } from "../../../../backend-helpers";

describe("POST /api/v1/internal/migrate-vercel-secrets-to-gcp", () => {
  it("rejects an invalid migration token before accessing GCP", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/internal/migrate-vercel-secrets-to-gcp", {
      method: "POST",
      headers: {
        "authorization": "Bearer invalid-migration-token",
      },
      body: {
        dry_run: true,
        destination_environment: "dev",
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
});
