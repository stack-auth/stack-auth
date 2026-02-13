import { it } from "../../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../../backend-helpers";


it("should not allow updating email templates when using shared email config", async ({ expect }) => {
  // Create a project with shared email config (default)
  await Auth.fastSignUp();
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  // Try to update an email template
  const response = await niceBackendFetch("/api/v1/internal/email-templates/a70fb3a4-56c1-4e42-af25-49d25603abd0", { // EMAIL_TEMPLATE_PASSWORD_RESET_ID
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      tsx_source: `
        import { Subject, NotificationCategory } from '@stackframe/emails';
        export const variablesSchema = (v) => v;
        export function EmailTemplate() {
          return <>
            <Subject value="Test Subject" />
            <NotificationCategory value="Transactional" />
            <div>Mock email template</div>
          </>;
        }
      `,
    },
  });

  // Verify that the update was rejected
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "REQUIRES_CUSTOM_EMAIL_SERVER",
        "error": "This action requires a custom SMTP server. Please edit your email server configuration and try again.",
      },
      "headers": Headers {
        "x-stack-known-error": "REQUIRES_CUSTOM_EMAIL_SERVER",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should allow adding and updating email templates with custom email config", async ({ expect }) => {
  // Create a project with custom email config
  await Auth.fastSignUp();
  await Project.createAndSwitch({
    config: {
      email_config: {
        type: 'standard',
        host: 'smtp.example.com',
        port: 587,
        username: 'test@example.com',
        password: 'password123',
        sender_name: 'Test App',
        sender_email: 'noreply@example.com'
      }
    }
  });

  const updateResponse = await niceBackendFetch("/api/v1/internal/email-templates/a70fb3a4-56c1-4e42-af25-49d25603abd0", { // EMAIL_TEMPLATE_PASSWORD_RESET_ID
    method: "PATCH",
    accessType: "admin",
    body: {
      tsx_source: `
        import { Subject, NotificationCategory } from '@stackframe/emails';
        export const variablesSchema = (v) => v;
        export function EmailTemplate() {
          return <>
            <Subject value="Test Subject" />
            <NotificationCategory value="Transactional" />
            <div>Mock email template</div>
          </>;
        }
      `,
    },
  });

  expect(updateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "rendered_html": "<!DOCTYPE html PUBLIC \\"-//W3C//DTD XHTML 1.0 Transitional//EN\\" \\"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\\"><html dir=\\"ltr\\" lang=\\"en\\"><head><meta content=\\"text/html; charset=UTF-8\\" http-equiv=\\"Content-Type\\"/><meta name=\\"x-apple-disable-message-reformatting\\"/></head><body style=\\"background-color:rgb(250,251,251);margin:0\\"><!--$--><table border=\\"0\\" width=\\"100%\\" cellPadding=\\"0\\" cellSpacing=\\"0\\" role=\\"presentation\\" align=\\"center\\"><tbody><tr><td style=\\"background-color:rgb(250,251,251);font-family:ui-sans-serif,system-ui,sans-serif,&quot;Apple Color Emoji&quot;,&quot;Segoe UI Emoji&quot;,&quot;Segoe UI Symbol&quot;,&quot;Noto Color Emoji&quot;;font-size:1rem;line-height:1.5;margin:0rem;padding:0rem;overflow-x:hidden\\"><div style=\\"padding-bottom:2rem;padding-top:2rem;padding-right:1rem;padding-left:1rem;display:flex;justify-content:center\\"><table align=\\"center\\" width=\\"100%\\" border=\\"0\\" cellPadding=\\"0\\" cellSpacing=\\"0\\" role=\\"presentation\\" style=\\"max-width:600px;background-color:rgb(255,255,255);padding:45px;border-radius:0.5rem;box-shadow:0 0 rgb(0,0,0,0),0 0 rgb(0,0,0,0),0 0 rgb(0,0,0,0),0 0 rgb(0,0,0,0),0 1px 3px 0 var(--tw-shadow-color, rgb(0 0 0 / 0.1)),0 1px 2px -1px var(--tw-shadow-color, rgb(0 0 0 / 0.1));margin-right:auto;margin-left:auto;width:100%\\"><tbody><tr style=\\"width:100%\\"><td><div>Mock email template</div></td></tr></tbody></table></div><table align=\\"center\\" width=\\"100%\\" border=\\"0\\" cellPadding=\\"0\\" cellSpacing=\\"0\\" role=\\"presentation\\" style=\\"padding:1rem;opacity:60%;text-align:center\\"><tbody><tr><td><a href=\\"https://example.com\\" target=\\"_blank\\" rel=\\"noopener noreferrer\\" style=\\"color:rgb(21,93,252)\\">Click here</a> to unsubscribe from these emails</td></tr></tbody></table></td></tr></tbody></table><!--7--><!--/$--></body></html>" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should create a new email template and be able to retrieve it", async ({ expect }) => {
  // Create a project with custom email config
  await Auth.fastSignUp();
  await Project.createAndSwitch({
    config: {
      email_config: {
        type: 'standard',
        host: 'smtp.example.com',
        port: 587,
        username: 'test@example.com',
        password: 'password123',
        sender_name: 'Test App',
        sender_email: 'noreply@example.com'
      }
    }
  });

  // Create a new template
  const createResponse = await niceBackendFetch("/api/v1/internal/email-templates", {
    method: "POST",
    accessType: "admin",
    body: {
      display_name: "Test Template",
    },
  });

  expect(createResponse.status).toBe(200);
  expect(createResponse.body.id).toBeDefined();

  const templateId = createResponse.body.id;

  // List templates and verify the new template is there
  const listResponse = await niceBackendFetch("/api/v1/internal/email-templates", {
    method: "GET",
    accessType: "admin",
  });

  expect(listResponse.status).toBe(200);
  expect(listResponse.body.templates).toBeDefined();

  // Find the newly created template
  const createdTemplate = listResponse.body.templates.find((t: any) => t.id === templateId);
  expect(createdTemplate).toBeDefined();
  expect(createdTemplate.display_name).toBe("Test Template");
});

it("should reject template that throws an error", async ({ expect }) => {
  await Auth.fastSignUp();
  await Project.createAndSwitch({
    config: {
      email_config: {
        type: 'standard',
        host: 'smtp.example.com',
        port: 587,
        username: 'test@example.com',
        password: 'password123',
        sender_name: 'Test App',
        sender_email: 'noreply@example.com'
      }
    }
  });

  const updateResponse = await niceBackendFetch("/api/v1/internal/email-templates/a70fb3a4-56c1-4e42-af25-49d25603abd0", {
    method: "PATCH",
    accessType: "admin",
    body: {
      tsx_source: `
        import { Subject, NotificationCategory } from '@stackframe/emails';
        export const variablesSchema = (v) => v;
        export function EmailTemplate() {
          throw new Error('Intentional error from template');
        }
      `,
    },
  });

  expect(updateResponse.status).toBe(400);
  expect(updateResponse.body).toMatchObject({
    code: "EMAIL_RENDERING_ERROR",
  });
  expect(updateResponse.body.error).toContain("Intentional error from template");
});

it("should reject template that does not export EmailTemplate function", async ({ expect }) => {
  await Auth.fastSignUp();
  await Project.createAndSwitch({
    config: {
      email_config: {
        type: 'standard',
        host: 'smtp.example.com',
        port: 587,
        username: 'test@example.com',
        password: 'password123',
        sender_name: 'Test App',
        sender_email: 'noreply@example.com'
      }
    }
  });

  const updateResponse = await niceBackendFetch("/api/v1/internal/email-templates/a70fb3a4-56c1-4e42-af25-49d25603abd0", {
    method: "PATCH",
    accessType: "admin",
    body: {
      tsx_source: `
        import { Subject, NotificationCategory } from '@stackframe/emails';
        export const variablesSchema = (v) => v;
        export function WrongFunctionName() {
          return <div>This should fail</div>;
        }
      `,
    },
  });

  expect(updateResponse.status).toBe(400);
  expect(updateResponse.body).toMatchObject({
    code: "EMAIL_RENDERING_ERROR",
  });
  // Error message varies by runtime
  expect(updateResponse.body.error).toBeDefined();
});

it("should reject template with invalid JSX syntax", async ({ expect }) => {
  await Auth.fastSignUp();
  await Project.createAndSwitch({
    config: {
      email_config: {
        type: 'standard',
        host: 'smtp.example.com',
        port: 587,
        username: 'test@example.com',
        password: 'password123',
        sender_name: 'Test App',
        sender_email: 'noreply@example.com'
      }
    }
  });

  const updateResponse = await niceBackendFetch("/api/v1/internal/email-templates/a70fb3a4-56c1-4e42-af25-49d25603abd0", {
    method: "PATCH",
    accessType: "admin",
    body: {
      tsx_source: `
        export function EmailTemplate() {
          return <div><span>unclosed tag
        }
      `,
    },
  });

  expect(updateResponse.status).toBe(400);
  expect(updateResponse.body).toMatchInlineSnapshot(`
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

it.todo("should reject template that causes infinite loop during rendering", async ({ expect }) => {
  await Auth.fastSignUp();
  await Project.createAndSwitch({
    config: {
      email_config: {
        type: 'standard',
        host: 'smtp.example.com',
        port: 587,
        username: 'test@example.com',
        password: 'password123',
        sender_name: 'Test App',
        sender_email: 'noreply@example.com'
      }
    }
  });

  const updateResponse = await niceBackendFetch("/api/v1/internal/email-templates/a70fb3a4-56c1-4e42-af25-49d25603abd0", {
    method: "PATCH",
    accessType: "admin",
    body: {
      tsx_source: `
        import { Subject, NotificationCategory } from '@stackframe/emails';
        export const variablesSchema = (v) => v;
        export function EmailTemplate() {
          while (true) {}
          return <div>Never reached</div>;
        }
      `,
    },
  });

  // Should timeout or return an error, not hang indefinitely
  expect(updateResponse.status).toBe(400);
  expect(updateResponse.body).toMatchInlineSnapshot("todo");
});

it.todo("should reject template that allocates too much memory", async ({ expect }) => {
  await Auth.fastSignUp();
  await Project.createAndSwitch({
    config: {
      email_config: {
        type: 'standard',
        host: 'smtp.example.com',
        port: 587,
        username: 'test@example.com',
        password: 'password123',
        sender_name: 'Test App',
        sender_email: 'noreply@example.com'
      }
    }
  });

  const updateResponse = await niceBackendFetch("/api/v1/internal/email-templates/a70fb3a4-56c1-4e42-af25-49d25603abd0", {
    method: "PATCH",
    accessType: "admin",
    body: {
      tsx_source: `
        import { Subject, NotificationCategory } from '@stackframe/emails';
        export const variablesSchema = (v) => v;
        export function EmailTemplate() {
          const arr = [];
          for (let i = 0; i < 1e9; i++) {
            arr.push(new Array(1e6).fill('x'));
          }
          return <div>{arr.length}</div>;
        }
      `,
    },
  });

  // Should fail due to memory limits, not hang or crash the server
  expect(updateResponse.status).toBe(400);
  expect(updateResponse.body).toMatchInlineSnapshot("todo");
});

it("should not allow deleting email templates when using shared email config", async ({ expect }) => {
  // Create a project with shared email config (default)
  await Auth.fastSignUp();
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  // Try to delete an email template
  const response = await niceBackendFetch("/api/v1/internal/email-templates/a70fb3a4-56c1-4e42-af25-49d25603abd0", { // EMAIL_TEMPLATE_PASSWORD_RESET_ID
    method: "DELETE",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });

  // Verify that the delete was rejected
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "REQUIRES_CUSTOM_EMAIL_SERVER",
        "error": "This action requires a custom SMTP server. Please edit your email server configuration and try again.",
      },
      "headers": Headers {
        "x-stack-known-error": "REQUIRES_CUSTOM_EMAIL_SERVER",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should successfully delete an email template with custom email config", async ({ expect }) => {
  // Create a project with custom email config
  await Auth.fastSignUp();
  await Project.createAndSwitch({
    config: {
      email_config: {
        type: 'standard',
        host: 'smtp.example.com',
        port: 587,
        username: 'test@example.com',
        password: 'password123',
        sender_name: 'Test App',
        sender_email: 'noreply@example.com'
      }
    }
  });

  // Create a new template to delete
  const createResponse = await niceBackendFetch("/api/v1/internal/email-templates", {
    method: "POST",
    accessType: "admin",
    body: {
      display_name: "Template to Delete",
    },
  });

  expect(createResponse.status).toBe(200);
  const templateId = createResponse.body.id;

  // Verify the template exists
  const listBeforeDelete = await niceBackendFetch("/api/v1/internal/email-templates", {
    method: "GET",
    accessType: "admin",
  });

  const templateBeforeDelete = listBeforeDelete.body.templates.find((t: any) => t.id === templateId);
  expect(templateBeforeDelete).toBeDefined();

  // Delete the template
  const deleteResponse = await niceBackendFetch(`/api/v1/internal/email-templates/${templateId}`, {
    method: "DELETE",
    accessType: "admin",
  });

  expect(deleteResponse.status).toBe(200);
  expect(deleteResponse.body).toEqual({});

  // Verify the template is removed from the list
  const listAfterDelete = await niceBackendFetch("/api/v1/internal/email-templates", {
    method: "GET",
    accessType: "admin",
  });

  const templateAfterDelete = listAfterDelete.body.templates.find((t: any) => t.id === templateId);
  expect(templateAfterDelete).toBeUndefined();
});

it("should return NotFound when deleting a non-existent template", async ({ expect }) => {
  // Create a project with custom email config
  await Auth.fastSignUp();
  await Project.createAndSwitch({
    config: {
      email_config: {
        type: 'standard',
        host: 'smtp.example.com',
        port: 587,
        username: 'test@example.com',
        password: 'password123',
        sender_name: 'Test App',
        sender_email: 'noreply@example.com'
      }
    }
  });

  // Try to delete a non-existent template with a valid UUID format
  const nonExistentTemplateId = "00000000-0000-0000-0000-000000000000";
  const deleteResponse = await niceBackendFetch(`/api/v1/internal/email-templates/${nonExistentTemplateId}`, {
    method: "DELETE",
    accessType: "admin",
  });

  // Verify that we get a 404 NotFound error
  expect(deleteResponse.status).toBe(404);
  expect(deleteResponse.body).toContain("No template found with given id");
});
