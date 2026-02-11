import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { it } from "../../../helpers";
import { niceBackendFetch } from "../../backend-helpers";

it("should return ok when email health check succeeds", async ({ expect }) => {
  const response = await niceBackendFetch("/health/email", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${getEnvVariable("STACK_EMAIL_MONITOR_SECRET_TOKEN")}`,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should reject requests with invalid token", async ({ expect }) => {
  const response = await niceBackendFetch("/health/email", {
    method: "POST",
    headers: {
      "authorization": "Bearer invalid-token",
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
