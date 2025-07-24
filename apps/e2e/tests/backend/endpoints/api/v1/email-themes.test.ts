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


