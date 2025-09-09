import { it } from "../../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../../backend-helpers";


it("should not allow updating email templates when using shared email config", async ({ expect }) => {
  // Create a project with shared email config (default)
  await Auth.Otp.signIn();
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
  await Auth.Otp.signIn();
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
      "body": { "rendered_html": "<!DOCTYPE html PUBLIC \\"-//W3C//DTD XHTML 1.0 Transitional//EN\\" \\"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\\"><html dir=\\"ltr\\" lang=\\"en\\"><head><meta content=\\"text/html; charset=UTF-8\\" http-equiv=\\"Content-Type\\"/><meta name=\\"x-apple-disable-message-reformatting\\"/></head><body style=\\"background-color:rgb(250,251,251);font-family:ui-sans-serif, system-ui, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;;font-size:1rem;line-height:1.5rem\\"><!--$--><table align=\\"center\\" width=\\"100%\\" border=\\"0\\" cellPadding=\\"0\\" cellSpacing=\\"0\\" role=\\"presentation\\" style=\\"background-color:rgb(255,255,255);padding:45px;border-radius:0.5rem;max-width:37.5em\\"><tbody><tr style=\\"width:100%\\"><td><div>Mock email template</div></td></tr></tbody></table><div style=\\"padding:1rem\\"><a href=\\"https://example.com\\" style=\\"color:#067df7;text-decoration-line:none\\" target=\\"_blank\\">Click here<!-- --> </a>to unsubscribe from these emails</div><!--7--><!--/$--></body></html>" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
