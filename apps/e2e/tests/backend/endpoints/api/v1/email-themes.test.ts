import { randomUUID } from "crypto";
import { describe } from "vitest";
import { it } from "../../../../helpers";
import { niceBackendFetch, Project } from "../../../backend-helpers";

const validThemeId = "1df07ae6-abf3-4a40-83a5-a1a2cbe336ac"; // Default Light theme
const invalidThemeId = randomUUID();

const validTsxSource = `import { Html, Tailwind, Body } from '@react-email/components';
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
}`;

const invalidTsxSource = `import { Html } from '@react-email/components';
function InvalidComponent() {
  return <Html>Invalid</Html>;
}`;

describe("get email theme", () => {
  it("should return 401 when invalid access type is provided", async ({ expect }) => {
    const response = await niceBackendFetch(
      `/api/latest/internal/email-themes/${validThemeId}`,
      {
        method: "GET",
        accessType: "client",
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 401,
        "body": {
          "code": "INSUFFICIENT_ACCESS_TYPE",
          "details": {
            "actual_access_type": "client",
            "allowed_access_types": ["admin"],
          },
          "error": "The x-stack-access-type header must be 'admin', but was 'client'.",
        },
        "headers": Headers {
          "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
          <some fields may have been hidden>,
        },
      }
    `);
  });

  it("should return 404 when theme not found", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Email Theme Project",
    });
    const response = await niceBackendFetch(
      `/api/latest/internal/email-themes/${invalidThemeId}`,
      {
        method: "GET",
        accessType: "admin",
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 404,
        "body": "No theme found with given id",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });

  it("should return 200 and theme data for valid theme", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Email Theme Project",
    });
    const response = await niceBackendFetch(
      `/api/latest/internal/email-themes/${validThemeId}`,
      {
        method: "GET",
        accessType: "admin",
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "display_name": "Default Light",
          "id": "<stripped UUID>",
          "tsx_source": deindent\`
            import { Html, Head, Tailwind, Body, Container, Link } from '@react-email/components';
            import { ThemeProps, ProjectLogo } from "@stackframe/emails";
            
            export function EmailTheme({ children, unsubscribeLink, projectLogos }: ThemeProps) {
              return (
                <Html>
                  <Head />
                  <Tailwind>
                    <Body className="bg-[#fafbfb] font-sans text-base">
                      <Container className="bg-white p-[45px] rounded-lg">
                        <ProjectLogo data={projectLogos} mode="light" />
                        {children}
                      </Container>
                      {unsubscribeLink && (
                        <div className="p-4">
                          <Link href={unsubscribeLink}>Click here{" "}</Link>
                          to unsubscribe from these emails
                        </div>
                      )}
                    </Body>
                  </Tailwind>
                </Html>
              );
            }
            
            EmailTheme.PreviewProps = {
              unsubscribeLink: "https://example.com",
            } satisfies Partial<ThemeProps>
          \` + "\\n",
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });
});

describe("update email theme", () => {
  it("should return 401 when invalid access type is provided", async ({ expect }) => {
    const response = await niceBackendFetch(
      `/api/latest/internal/email-themes/${validThemeId}`,
      {
        method: "PATCH",
        accessType: "client",
        body: {
          tsx_source: validTsxSource,
        },
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 401,
        "body": {
          "code": "INSUFFICIENT_ACCESS_TYPE",
          "details": {
            "actual_access_type": "client",
            "allowed_access_types": ["admin"],
          },
          "error": "The x-stack-access-type header must be 'admin', but was 'client'.",
        },
        "headers": Headers {
          "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
          <some fields may have been hidden>,
        },
      }
    `);
  });

  it("should return 404 when theme not found", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Email Theme Project",
    });
    const response = await niceBackendFetch(
      `/api/latest/internal/email-themes/${invalidThemeId}`,
      {
        method: "PATCH",
        accessType: "admin",
        body: {
          tsx_source: validTsxSource,
        },
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 404,
        "body": "No theme found with given id",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });

  it("should return 200 and update theme successfully", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Email Theme Project",
    });
    const response = await niceBackendFetch(
      `/api/latest/internal/email-themes/${validThemeId}`,
      {
        method: "PATCH",
        accessType: "admin",
        body: {
          tsx_source: validTsxSource,
        },
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "display_name": "Default Light" },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });

  it("should persist theme changes after update", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Email Theme Project",
    });

    const updateResponse = await niceBackendFetch(
      `/api/latest/internal/email-themes/${validThemeId}`,
      {
        method: "PATCH",
        accessType: "admin",
        body: {
          tsx_source: validTsxSource,
        },
      }
    );
    expect(updateResponse.status).toBe(200);

    const getResponse = await niceBackendFetch(
      `/api/latest/internal/email-themes/${validThemeId}`,
      {
        method: "GET",
        accessType: "admin",
      }
    );
    expect(getResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "display_name": "Default Light",
          "id": "<stripped UUID>",
          "tsx_source": deindent\`
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
          \`,
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });
});

describe("create email theme", () => {
  it("should get all themes, then successfully create theme with existing name", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Email Theme Project",
    });

    // First get all themes to verify default themes exist
    const getResponse = await niceBackendFetch(
      `/api/latest/internal/email-themes`,
      {
        method: "GET",
        accessType: "admin",
      }
    );
    expect(getResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "themes": [
            {
              "display_name": "Default Light",
              "id": "<stripped UUID>",
            },
            {
              "display_name": "Default Dark",
              "id": "<stripped UUID>",
            },
          ],
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // Create a theme with the same name as existing theme - this should now work
    const createResponse = await niceBackendFetch(
      `/api/latest/internal/email-themes`,
      {
        method: "POST",
        accessType: "admin",
        body: {
          display_name: "Default Light",
        },
      }
    );
    expect(createResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "id": "<stripped UUID>" },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });
});

describe("create, patch, and get email theme", () => {
  it("should create a new theme, patch it, and get it to verify updates", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Email Theme Project",
    });

    // Create a new theme
    const createResponse = await niceBackendFetch(
      `/api/latest/internal/email-themes`,
      {
        method: "POST",
        accessType: "admin",
        body: {
          display_name: "Custom Theme",
        },
      }
    );
    expect(createResponse.status).toBe(200);
    expect(createResponse.body).toHaveProperty("id");
    const themeId = createResponse.body.id;

    // Patch the theme
    const patchResponse = await niceBackendFetch(
      `/api/latest/internal/email-themes/${themeId}`,
      {
        method: "PATCH",
        accessType: "admin",
        body: {
          tsx_source: validTsxSource,
        },
      }
    );
    expect(patchResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "display_name": "Custom Theme" },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // Get the theme to verify it was updated
    const getResponse = await niceBackendFetch(
      `/api/latest/internal/email-themes/${themeId}`,
      {
        method: "GET",
        accessType: "admin",
      }
    );
    expect(getResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "display_name": "Custom Theme",
          "id": "<stripped UUID>",
          "tsx_source": deindent\`
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
          \`,
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });
});

describe("invalid JSX inputs", () => {
  it("should reject theme that throws an error when rendered", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Email Theme Project",
    });

    const response = await niceBackendFetch(
      `/api/latest/internal/email-themes/${validThemeId}`,
      {
        method: "PATCH",
        accessType: "admin",
        body: {
          tsx_source: `
            import { Html } from '@react-email/components';
            export function EmailTheme({ children }: { children: React.ReactNode }) {
              throw new Error('Intentional error from theme');
            }
          `,
        },
      }
    );
    expect(response.status).toBe(400);
    expect(response.body).toMatchInlineSnapshot("???");
  });

  it("should reject theme that does not export EmailTheme function", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Email Theme Project",
    });

    const response = await niceBackendFetch(
      `/api/latest/internal/email-themes/${validThemeId}`,
      {
        method: "PATCH",
        accessType: "admin",
        body: {
          tsx_source: `
            import { Html } from '@react-email/components';
            export function WrongFunctionName({ children }: { children: React.ReactNode }) {
              return <Html>{children}</Html>;
            }
          `,
        },
      }
    );
    expect(response.status).toBe(400);
    expect(response.body).toMatchInlineSnapshot(`
      {
        "code": "EMAIL_RENDERING_ERROR",
        "details": {
          "error": deindent\`
            Build failed with 1 error:
            virtual:/render.tsx:9:9: ERROR: No matching export in "virtual:/theme.tsx" for import "EmailTheme"
          \`,
        },
        "error": deindent\`
          Failed to render email with theme: Build failed with 1 error:
          virtual:/render.tsx:9:9: ERROR: No matching export in "virtual:/theme.tsx" for import "EmailTheme"
        \`,
      }
    `);
  });

  it("should reject theme with invalid JSX syntax", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Email Theme Project",
    });

    const response = await niceBackendFetch(
      `/api/latest/internal/email-themes/${validThemeId}`,
      {
        method: "PATCH",
        accessType: "admin",
        body: {
          tsx_source: `
            export function EmailTheme({ children }) {
              return <div><span>unclosed tag
            }
          `,
        },
      }
    );
    expect(response.status).toBe(400);
    expect(response.body).toMatchInlineSnapshot(`
      {
        "code": "EMAIL_RENDERING_ERROR",
        "details": {
          "error": deindent\`
            Build failed with 2 errors:
            virtual:/theme.tsx:4:12: ERROR: The character "}" is not valid inside a JSX element
            virtual:/theme.tsx:5:10: ERROR: Unexpected end of file before a closing "span" tag
          \`,
        },
        "error": deindent\`
          Failed to render email with theme: Build failed with 2 errors:
          virtual:/theme.tsx:4:12: ERROR: The character "}" is not valid inside a JSX element
          virtual:/theme.tsx:5:10: ERROR: Unexpected end of file before a closing "span" tag
        \`,
      }
    `);
  });

  it.todo("should reject theme that causes infinite loop during rendering", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Email Theme Project",
    });

    const response = await niceBackendFetch(
      `/api/latest/internal/email-themes/${validThemeId}`,
      {
        method: "PATCH",
        accessType: "admin",
        body: {
          tsx_source: `
            import { Html } from '@react-email/components';
            export function EmailTheme({ children }: { children: React.ReactNode }) {
              while (true) {}
              return <Html>{children}</Html>;
            }
          `,
        },
      }
    );
    // Should timeout or return an error, not hang indefinitely
    expect(response.status).toBe(400);
    expect(response.body).toMatchInlineSnapshot("todo");
  });

  it.todo("should reject theme that allocates too much memory", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Email Theme Project",
    });

    const response = await niceBackendFetch(
      `/api/latest/internal/email-themes/${validThemeId}`,
      {
        method: "PATCH",
        accessType: "admin",
        body: {
          tsx_source: `
            import { Html } from '@react-email/components';
            export function EmailTheme({ children }: { children: React.ReactNode }) {
              const arr = [];
              for (let i = 0; i < 1e9; i++) {
                arr.push(new Array(1e6).fill('x'));
              }
              return <Html>{children}</Html>;
            }
          `,
        },
      }
    );
    // Should fail due to memory limits, not hang or crash the server
    expect(response.status).toBe(400);
    expect(response.body).toMatchInlineSnapshot("todo");
  });

  it("should reject theme that exports a non-function", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Email Theme Project",
    });

    const response = await niceBackendFetch(
      `/api/latest/internal/email-themes/${validThemeId}`,
      {
        method: "PATCH",
        accessType: "admin",
        body: {
          tsx_source: `
            export const EmailTheme = "not a function";
          `,
        },
      }
    );
    expect(response.status).toBe(400);
    expect(response.body).toMatchInlineSnapshot(`
      {
        "code": "EMAIL_RENDERING_ERROR",
        "details": { "error": "{\\"message\\":\\"element.type is not a function. (In 'element.type(element.props || {})', 'element.type' is \\\\\\"not a function\\\\\\")\\",\\"stack\\":\\"TypeError: element.type is not a function. (In 'element.type(element.props || {})', 'element.type' is \\\\\\"not a function\\\\\\")\\\\n    at findComponentValue (/app/tmp/job-<stripped UUID>/script.ts:70:20)\\\\n    at <anonymous> (/app/tmp/job-<stripped UUID>/script.ts:145:18)\\\\n    at fulfilled (/app/tmp/job-<stripped UUID>/script.ts:32:24)\\"}" },
        "error": "Failed to render email with theme: {\\"message\\":\\"element.type is not a function. (In 'element.type(element.props || {})', 'element.type' is \\\\\\"not a function\\\\\\")\\",\\"stack\\":\\"TypeError: element.type is not a function. (In 'element.type(element.props || {})', 'element.type' is \\\\\\"not a function\\\\\\")\\\\n    at findComponentValue (/app/tmp/job-<stripped UUID>/script.ts:70:20)\\\\n    at <anonymous> (/app/tmp/job-<stripped UUID>/script.ts:145:18)\\\\n    at fulfilled (/app/tmp/job-<stripped UUID>/script.ts:32:24)\\"}",
      }
    `);
  });
});

