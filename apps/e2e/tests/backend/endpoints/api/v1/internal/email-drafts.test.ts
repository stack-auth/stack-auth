import { it } from "../../../../../helpers";
import { withPortPrefix } from "../../../../../helpers/ports";
import { Project, niceBackendFetch } from "../../../../backend-helpers";

const customEmailConfig = {
  type: "standard",
  host: "localhost",
  port: Number(withPortPrefix("29")),
  username: "test",
  password: "test",
  sender_name: "Test Project",
  sender_email: "test@example.com",
} as const;

it("should create, list, get, and update email drafts", async ({ expect }) => {
  await Project.createAndSwitch({
    display_name: "Email Drafts CRUD Project",
    config: { email_config: customEmailConfig },
  });

  const initialSource = `import { Container } from "@react-email/components";
import { Subject, NotificationCategory, Props } from "@stackframe/emails";
export function EmailTemplate({ user, project }: Props) {
  return (
    <Container>
      <Subject value="Draft Test Subject" />
      <NotificationCategory value="Transactional" />
      <div>Hi {user.displayName}</div>
    </Container>
  );
}`;

  const createRes = await niceBackendFetch("/api/v1/internal/email-drafts", {
    method: "POST",
    accessType: "admin",
    body: {
      display_name: "My Draft",
      theme_id: false,
      tsx_source: initialSource,
    },
  });
  expect(createRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "id": "<stripped UUID>" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  const draftId = createRes.body.id as string;

  const listRes = await niceBackendFetch("/api/v1/internal/email-drafts", {
    method: "GET",
    accessType: "admin",
  });
  expect(listRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "drafts": [
          {
            "display_name": "My Draft",
            "id": "<stripped UUID>",
            "sent_at_millis": <stripped field 'sent_at_millis'>,
            "theme_id": false,
            "tsx_source": deindent\`
              import { Container } from "@react-email/components";
              import { Subject, NotificationCategory, Props } from "@stackframe/emails";
              export function EmailTemplate({ user, project }: Props) {
                return (
                  <Container>
                    <Subject value="Draft Test Subject" />
                    <NotificationCategory value="Transactional" />
                    <div>Hi {user.displayName}</div>
                  </Container>
                );
              }
            \`,
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const getRes1 = await niceBackendFetch(`/api/v1/internal/email-drafts/${draftId}`, {
    method: "GET",
    accessType: "admin",
  });
  expect(getRes1).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "display_name": "My Draft",
        "id": "<stripped UUID>",
        "sent_at_millis": <stripped field 'sent_at_millis'>,
        "theme_id": false,
        "tsx_source": deindent\`
          import { Container } from "@react-email/components";
          import { Subject, NotificationCategory, Props } from "@stackframe/emails";
          export function EmailTemplate({ user, project }: Props) {
            return (
              <Container>
                <Subject value="Draft Test Subject" />
                <NotificationCategory value="Transactional" />
                <div>Hi {user.displayName}</div>
              </Container>
            );
          }
        \`,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const updatedSource = `import { Container } from "@react-email/components";
import { Subject, NotificationCategory, Props } from "@stackframe/emails";
export function EmailTemplate({ user, project }: Props) {
  return (
    <Container>
      <Subject value="Updated Draft Subject" />
      <NotificationCategory value="Transactional" />
      <div>Updated for {user.displayName}</div>
    </Container>
  );
}`;

  const patchRes = await niceBackendFetch(`/api/v1/internal/email-drafts/${draftId}`, {
    method: "PATCH",
    accessType: "admin",
    body: {
      display_name: "Updated Draft",
      tsx_source: updatedSource,
      theme_id: false,
    },
  });
  expect(patchRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "ok": "ok" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const getRes2 = await niceBackendFetch(`/api/v1/internal/email-drafts/${draftId}`, {
    method: "GET",
    accessType: "admin",
  });
  expect(getRes2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "display_name": "Updated Draft",
        "id": "<stripped UUID>",
        "sent_at_millis": <stripped field 'sent_at_millis'>,
        "theme_id": false,
        "tsx_source": deindent\`
          import { Container } from "@react-email/components";
          import { Subject, NotificationCategory, Props } from "@stackframe/emails";
          export function EmailTemplate({ user, project }: Props) {
            return (
              <Container>
                <Subject value="Updated Draft Subject" />
                <NotificationCategory value="Transactional" />
                <div>Updated for {user.displayName}</div>
              </Container>
            );
          }
        \`,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should render an email draft via render-email endpoint", async ({ expect }) => {
  await Project.createAndSwitch({
    display_name: "Email Drafts Render Project",
    config: { email_config: customEmailConfig },
  });

  const tsxSource = `import { Container } from "@react-email/components";
import { Subject, NotificationCategory, Props } from "@stackframe/emails";
export function EmailTemplate({ user, project }: Props) {
  return (
    <Container>
      <Subject value="Render Draft Subject" />
      <NotificationCategory value="Transactional" />
      <div>Preview for {user.displayName}</div>
    </Container>
  );
}`;

  const createRes = await niceBackendFetch("/api/v1/internal/email-drafts", {
    method: "POST",
    accessType: "admin",
    body: {
      display_name: "Render Draft",
      theme_id: false,
      tsx_source: tsxSource,
    },
  });
  expect(createRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "id": "<stripped UUID>" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const renderRes = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      template_tsx_source: tsxSource,
      theme_id: false,
    },
  });
  expect(renderRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "html": "<!DOCTYPE html PUBLIC \\"-//W3C//DTD XHTML 1.0 Transitional//EN\\" \\"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\\"><html dir=\\"ltr\\" lang=\\"en\\"><head></head><body><!--$--><table border=\\"0\\" width=\\"100%\\" cellPadding=\\"0\\" cellSpacing=\\"0\\" role=\\"presentation\\" align=\\"center\\"><tbody><tr><td><table align=\\"center\\" width=\\"100%\\" border=\\"0\\" cellPadding=\\"0\\" cellSpacing=\\"0\\" role=\\"presentation\\" style=\\"max-width:37.5em\\"><tbody><tr style=\\"width:100%\\"><td><div>Preview for <!-- -->John Doe</div></td></tr></tbody></table></td></tr></tbody></table><!--3--><!--/$--></body></html>",
        "notification_category": "Transactional",
        "subject": "Render Draft Subject",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});


it("should require admin access for internal email draft routes", async ({ expect }) => {
  await Project.createAndSwitch();

  const response = await niceBackendFetch("/api/v1/internal/email-drafts", {
    method: "GET",
    accessType: "server",
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "INSUFFICIENT_ACCESS_TYPE",
        "details": {
          "actual_access_type": "server",
          "allowed_access_types": ["admin"],
        },
        "error": "The x-stack-access-type header must be 'admin', but was 'server'.",
      },
      "headers": Headers {
        "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should return schema error when creating draft without display_name", async ({ expect }) => {
  await Project.createAndSwitch();

  const response = await niceBackendFetch("/api/v1/internal/email-drafts", {
    method: "POST",
    accessType: "admin",
    body: {
      theme_id: false,
      tsx_source: "export function EmailTemplate(){return null}",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/internal/email-drafts:
              - body.display_name must be defined
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/internal/email-drafts:
            - body.display_name must be defined
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should return schema error when updating draft with invalid theme_id type", async ({ expect }) => {
  await Project.createAndSwitch();

  const createRes = await niceBackendFetch("/api/v1/internal/email-drafts", {
    method: "POST",
    accessType: "admin",
    body: {
      display_name: "To Update",
      theme_id: false,
      tsx_source: "export function EmailTemplate(){return null}",
    },
  });
  expect(createRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "id": "<stripped UUID>" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  const draftId = createRes.body.id as string;

  const response = await niceBackendFetch(`/api/v1/internal/email-drafts/${draftId}`, {
    method: "PATCH",
    accessType: "admin",
    body: {
      theme_id: 123 as any,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on PATCH /api/v1/internal/email-drafts/<stripped UUID>:
              - body.theme_id is invalid
          \`,
        },
        "error": deindent\`
          Request validation failed on PATCH /api/v1/internal/email-drafts/<stripped UUID>:
            - body.theme_id is invalid
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should fail rendering with non-existent theme id", async ({ expect }) => {
  await Project.createAndSwitch();

  const renderRes = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      template_tsx_source: "export function EmailTemplate(){return null}",
      theme_id: "non-existent-theme",
    },
  });
  expect(renderRes).toMatchInlineSnapshot(`
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
                  body.theme_id is invalid
                  body contains unknown properties: template_tsx_source
                Schema 1:
                  body.template_id must be defined
                  body.theme_tsx_source must be defined
                  body contains unknown properties: template_tsx_source, theme_id
                Schema 2:
                  body.theme_id is invalid
                Schema 3:
                  body.theme_tsx_source must be defined
                  body contains unknown properties: theme_id
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/emails/render-email:
            - body is not matched by any of the provided schemas:
              Schema 0:
                body.template_id must be defined
                body.theme_id is invalid
                body contains unknown properties: template_tsx_source
              Schema 1:
                body.template_id must be defined
                body.theme_tsx_source must be defined
                body contains unknown properties: template_tsx_source, theme_id
              Schema 2:
                body.theme_id is invalid
              Schema 3:
                body.theme_tsx_source must be defined
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

it("should reject draft that throws an error when rendered", async ({ expect }) => {
  await Project.createAndSwitch({
    display_name: "Email Drafts Invalid JSX Project",
    config: { email_config: customEmailConfig },
  });

  const createRes = await niceBackendFetch("/api/v1/internal/email-drafts", {
    method: "POST",
    accessType: "admin",
    body: {
      display_name: "Throwing Draft",
      theme_id: false,
      tsx_source: `
        import { Subject, NotificationCategory } from "@stackframe/emails";
        export function EmailTemplate() {
          throw new Error('Intentional error from draft');
        }
      `,
    },
  });
  expect(createRes.status).toBe(200);
  const draftId = createRes.body.id as string;

  // Attempt to render the draft
  const renderRes = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      template_tsx_source: `
        import { Subject, NotificationCategory } from "@stackframe/emails";
        export function EmailTemplate() {
          throw new Error('Intentional error from draft');
        }
      `,
      theme_id: false,
    },
  });
  expect(renderRes.status).toBe(400);
  expect(renderRes.body).toMatchObject({
    code: "EMAIL_RENDERING_ERROR",
  });
  expect(renderRes.body.error).toContain("Intentional error from draft");
});

it("should reject draft that does not export EmailTemplate function", async ({ expect }) => {
  await Project.createAndSwitch({
    display_name: "Email Drafts Invalid JSX Project",
    config: { email_config: customEmailConfig },
  });

  const renderRes = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      template_tsx_source: `
        import { Subject, NotificationCategory } from "@stackframe/emails";
        export function WrongFunctionName() {
          return <div>This should fail</div>;
        }
      `,
      theme_id: false,
    },
  });
  expect(renderRes.status).toBe(400);
  expect(renderRes.body).toMatchObject({
    code: "EMAIL_RENDERING_ERROR",
  });
  // Error message varies by runtime
  expect(renderRes.body.error).toBeDefined();
});

it("should reject draft with invalid JSX syntax", async ({ expect }) => {
  await Project.createAndSwitch({
    display_name: "Email Drafts Invalid JSX Project",
    config: { email_config: customEmailConfig },
  });

  const renderRes = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      template_tsx_source: `
        export function EmailTemplate() {
          return <div><span>unclosed tag
        }
      `,
      theme_id: false,
    },
  });
  expect(renderRes.status).toBe(400);
  expect(renderRes.body).toMatchInlineSnapshot(`
    {
      "code": "EMAIL_RENDERING_ERROR",
      "details": {
        "error": deindent\`
          Build failed with 2 errors:
          virtual:/template.tsx:4:8: ERROR: The character "}" is not valid inside a JSX element
          virtual:/template.tsx:5:6: ERROR: Unexpected end of file before a closing "span" tag
        \`,
      },
      "error": deindent\`
        Failed to render email with theme: Build failed with 2 errors:
        virtual:/template.tsx:4:8: ERROR: The character "}" is not valid inside a JSX element
        virtual:/template.tsx:5:6: ERROR: Unexpected end of file before a closing "span" tag
      \`,
    }
  `);
});

it.todo("should reject draft that causes infinite loop during rendering", async ({ expect }) => {
  await Project.createAndSwitch({
    display_name: "Email Drafts Invalid JSX Project",
    config: { email_config: customEmailConfig },
  });

  const renderRes = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      template_tsx_source: `
        import { Subject, NotificationCategory } from "@stackframe/emails";
        export function EmailTemplate() {
          while (true) {}
          return <div>Never reached</div>;
        }
      `,
      theme_id: false,
    },
  });
  // Should timeout or return an error, not hang indefinitely
  expect(renderRes.status).toBe(400);
  expect(renderRes.body).toMatchInlineSnapshot("todo");
});

it.todo("should reject draft that allocates too much memory", async ({ expect }) => {
  await Project.createAndSwitch({
    display_name: "Email Drafts Invalid JSX Project",
    config: { email_config: customEmailConfig },
  });

  const renderRes = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      template_tsx_source: `
        import { Subject, NotificationCategory } from "@stackframe/emails";
        export function EmailTemplate() {
          const arr = [];
          for (let i = 0; i < 1e9; i++) {
            arr.push(new Array(1e6).fill('x'));
          }
          return <div>{arr.length}</div>;
        }
      `,
      theme_id: false,
    },
  });
  // Should fail due to memory limits, not hang or crash the server
  expect(renderRes.status).toBe(400);
  expect(renderRes.body).toMatchObject({
    code: "EMAIL_RENDERING_ERROR",
  });
});

it("should reject draft that exports a non-function", async ({ expect }) => {
  await Project.createAndSwitch({
    display_name: "Email Drafts Invalid JSX Project",
    config: { email_config: customEmailConfig },
  });

  const renderRes = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      template_tsx_source: `
        export const EmailTemplate = "not a function";
      `,
      theme_id: false,
    },
  });
  expect(renderRes.status).toBe(400);
  expect(renderRes.body).toMatchObject({
    code: "EMAIL_RENDERING_ERROR",
  });
  // Error message varies by runtime
  expect(renderRes.body.error).toBeDefined();
});

it("should reject theme_tsx_source that throws an error when rendered", async ({ expect }) => {
  await Project.createAndSwitch({
    display_name: "Email Drafts Invalid JSX Project",
    config: { email_config: customEmailConfig },
  });

  const renderRes = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      template_tsx_source: `
        import { Subject, NotificationCategory } from "@stackframe/emails";
        export function EmailTemplate() {
          return <div>Valid template</div>;
        }
      `,
      theme_tsx_source: `
        import { Html } from '@react-email/components';
        export function EmailTheme({ children }) {
          throw new Error('Intentional error from theme');
        }
      `,
    },
  });
  expect(renderRes.status).toBe(400);
  expect(renderRes.body).toMatchObject({
    code: "EMAIL_RENDERING_ERROR",
  });
  expect(renderRes.body.error).toContain("Intentional error from theme");
});

it("should reject theme_tsx_source that does not export EmailTheme function", async ({ expect }) => {
  await Project.createAndSwitch({
    display_name: "Email Drafts Invalid JSX Project",
    config: { email_config: customEmailConfig },
  });

  const renderRes = await niceBackendFetch("/api/v1/emails/render-email", {
    method: "POST",
    accessType: "admin",
    body: {
      template_tsx_source: `
        import { Subject, NotificationCategory } from "@stackframe/emails";
        export function EmailTemplate() {
          return <div>Valid template</div>;
        }
      `,
      theme_tsx_source: `
        import { Html } from '@react-email/components';
        export function WrongThemeName({ children }) {
          return <Html>{children}</Html>;
        }
      `,
    },
  });
  expect(renderRes.status).toBe(400);
  expect(renderRes.body).toMatchInlineSnapshot(`
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
