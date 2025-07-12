import { it } from "../../../../helpers";
import { niceBackendFetch } from "../../../backend-helpers";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";

it("should return 400 when theme is not found", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      theme_id: generateUuid(),
      preview_html: "<p>Test email</p>",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "No theme found with given id",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should render mock email when valid theme is provided", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      theme_id: "1df07ae6-abf3-4a40-83a5-a1a2cbe336ac", // default-light
      preview_html: "<p>Test email</p>",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "html": deindent\`
          <div>Mock api key detected, themeComponent: import { Html, Tailwind, Body } from '@react-email/components';
          function EmailTheme({ children }: { children: React.ReactNode }) {
            return (
              <Html>
                <Tailwind>
                  <Body>
                    <div className="bg-white text-slate-800 p-4 rounded-lg max-w-[600px] mx-auto leading-relaxed">
                      {children}
                    </div>
                  </Body>
                </Tailwind>
              </Html>
            );
          }, htmlContent: <p>Test email</p>, </div>
        \`,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
