import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { it } from "../../../../helpers";
import { niceBackendFetch } from "../../../backend-helpers";

it("should return 400 when theme is not found", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      theme_id: generateUuid(),
      template_tsx_source: "import { type } from 'arktype'; export function EmailTemplate() { return <p>Test email</p>; } export const variablesSchema = type({});",
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
        export function EmailTheme({ children }: { children: React.ReactNode }) {
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
      template_tsx_source: "import { type } from 'arktype'; export function EmailTemplate() { return <p>Test email</p>; } export const variablesSchema = type({});",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/emails/render-email:
              - body is not matched by any of the provided schemas:
                Schema 0:
                  body.template_id must be defined
                  body contains unknown properties: theme_tsx_source, template_tsx_source
                Schema 1:
                  body.template_id must be defined
                  body contains unknown properties: theme_id, template_tsx_source
                Schema 2:
                  body contains unknown properties: theme_tsx_source
                Schema 3:
                  body contains unknown properties: theme_id
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/emails/render-email:
            - body is not matched by any of the provided schemas:
              Schema 0:
                body.template_id must be defined
                body contains unknown properties: theme_tsx_source, template_tsx_source
              Schema 1:
                body.template_id must be defined
                body contains unknown properties: theme_id, template_tsx_source
              Schema 2:
                body contains unknown properties: theme_tsx_source
              Schema 3:
                body contains unknown properties: theme_id
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
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
        export function EmailTheme({ children }: { children: React.ReactNode }) {
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
      `,
      template_tsx_source: `
        import { type } from "arktype";
        export function EmailTemplate() { 
          return <p>Test email content</p>; 
        }
        export const variablesSchema = type({});
      `,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "html": "<!DOCTYPE html PUBLIC \\"-//W3C//DTD XHTML 1.0 Transitional//EN\\" \\"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\\"><html dir=\\"ltr\\" lang=\\"en\\"><head></head><body><!--$--><table border=\\"0\\" width=\\"100%\\" cellPadding=\\"0\\" cellSpacing=\\"0\\" role=\\"presentation\\" align=\\"center\\"><tbody><tr><td><div style=\\"background-color:rgb(255,255,255);color:rgb(29,41,61);padding:1rem;border-radius:0.5rem;max-width:600px;margin-right:auto;margin-left:auto;line-height:1.625\\"><p>Test email content</p></div></td></tr></tbody></table><!--3--><!--/$--></body></html>" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should return 400 when theme throws an error during rendering", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      theme_tsx_source: `
        import { Html, Body } from '@react-email/components';
        export function EmailTheme({ children }: { children: React.ReactNode }) {
          throw new Error("Theme rendering error");
          return (
            <Html>
              <Body>
                <div>{children}</div>
              </Body>
            </Html>
          );
        }
      `,
      template_tsx_source: `
        import { type } from "arktype";
        export function EmailTemplate() { 
          return <p>Test email content</p>; 
        }
        export const variablesSchema = type({});
      `,
    },
  });
  expect(response.status).toBe(400);
  expect(response.body).toMatchObject({
    code: "EMAIL_RENDERING_ERROR",
  });
  expect(response.headers.get("x-stack-known-error")).toBe("EMAIL_RENDERING_ERROR");
  // Verify the error message contains the user's error
  expect(response.body.error).toContain("Theme rendering error");
  expect(response.body.details.error).toContain("Theme rendering error");
});

it("should return 400 when template throws an error during rendering", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      theme_tsx_source: `
        import { Html, Body } from '@react-email/components';
        export function EmailTheme({ children }: { children: React.ReactNode }) {
          return (
            <Html>
              <Body>
                <div>{children}</div>
              </Body>
            </Html>
          );
        }
      `,
      template_tsx_source: `
        import { type } from "arktype";
        export function EmailTemplate() { 
          throw new Error("Template rendering error");
          return <p>Test email content</p>; 
        }
        export const variablesSchema = type({});
      `,
    },
  });
  expect(response.status).toBe(400);
  expect(response.body).toMatchObject({
    code: "EMAIL_RENDERING_ERROR",
  });
  expect(response.headers.get("x-stack-known-error")).toBe("EMAIL_RENDERING_ERROR");
  // Verify the error message contains the user's error
  expect(response.body.error).toContain("Template rendering error");
  expect(response.body.details.error).toContain("Template rendering error");
});
