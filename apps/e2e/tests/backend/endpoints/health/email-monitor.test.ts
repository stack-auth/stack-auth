import { it } from "../../../helpers";
import { niceBackendFetch } from "../../backend-helpers";

it("should return ok when email health check succeeds", async ({ expect }) => {
  const response = await niceBackendFetch("/health/email", {});
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "message": "Sign-up and sending of verification email successful",
        "status": "ok",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
