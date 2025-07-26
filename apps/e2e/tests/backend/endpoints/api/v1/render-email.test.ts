import { it } from "../../../../helpers";
import { niceBackendFetch } from "../../../backend-helpers";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";

it("should return 400 when theme is not found", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      theme_id: generateUuid(),
      template_tsx_source: "export default function EmailTemplate() { return <p>Test email</p>; }",
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

it("should return 400 when template is not found", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      theme_tsx_source: `
        import { Html, Tailwind, Body } from '@react-email/components';
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
        }
        export default EmailTheme;
      `,
      template_id: generateUuid(),
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "No template found with given id",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should return 400 when both theme_id and theme_tsx_source are provided", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      theme_id: "1df07ae6-abf3-4a40-83a5-a1a2cbe336ac",
      theme_tsx_source: "export default function Theme() { return <div>{children}</div>; }",
      template_tsx_source: "export default function EmailTemplate() { return <p>Test email</p>; }",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Exactly one of theme_id or theme_tsx_source must be provided",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should return 400 when both template_id and template_tsx_source are provided", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      theme_tsx_source: `
        import { Html, Tailwind, Body } from '@react-email/components';
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
        }
        export default EmailTheme;
      `,
      template_id: "some-template-id",
      template_tsx_source: "export default function EmailTemplate() { return <p>Test email</p>; }",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Exactly one of template_id or template_tsx_source must be provided",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should render email when valid theme and template TSX sources are provided", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      theme_tsx_source: `
        import { Html, Tailwind, Body } from '@react-email/components';
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
        }
        export default EmailTheme;
      `,
      template_tsx_source: "export default function EmailTemplate() { return <p>Test email content</p>; }",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "html": deindent\`
          <div>Mock api key detected, 
          
          templateComponent: export default function EmailTemplate() { return <p>Test email content</p>; }
          
          themeComponent: 
                  import { Html, Tailwind, Body } from '@react-email/components';
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
                  }
                  export default EmailTheme;
                
          
           variables: {}</div>
        \`,
        "notification_category": "mock notification category",
        "subject": "mock subject",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
