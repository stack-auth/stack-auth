import { it } from "../../../helpers";
import { niceBackendFetch } from "../../backend-helpers";

it("checks Postgres without changing the existing health response", async ({ expect }) => {
  const response = await niceBackendFetch("/health?db=1");

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "status": "ok" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
