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
      "status": 400,
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
      "body": { "html": "<!DOCTYPE html PUBLIC \\"-//W3C//DTD XHTML 1.0 Transitional//EN\\" \\"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\\"><html dir=\\"ltr\\" lang=\\"en\\"><head></head><body><!--$--><div style=\\"background-color:rgb(15,23,42);color:rgb(241,245,249);padding:1rem;border-radius:0.5rem;max-width:600px;margin-left:auto;margin-right:auto;line-height:1.625\\"><div><p>Test email</p></div></div><!--3--><!--/$--></body></html>" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
