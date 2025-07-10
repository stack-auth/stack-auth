import { it } from "../../../../helpers";
import { niceBackendFetch } from "../../../backend-helpers";

it("should return 404 when theme is not found", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      theme: "test",
      preview_html: "<p>Test email</p>",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": "No theme found with given name",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should render mock email when valid theme is provided", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      theme: "default-dark",
      preview_html: "<p>Test email</p>",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "html": "<div>Mock api key detected, returning mock data </div>" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
