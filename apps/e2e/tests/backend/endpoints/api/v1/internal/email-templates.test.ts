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
      tsx_source: "mock_tsx_source",
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
      tsx_source: "mock_tsx_source",
    },
  });

  expect(updateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "rendered_html": deindent\`
          <div>Mock api key detected, 
          
          templateComponent: mock_tsx_source
          
          themeComponent: import { Html, Head, Tailwind, Body, Container } from '@react-email/components';
          
          export function EmailTheme({ children }: { children: React.ReactNode }) {
            return (
              <Html>
                <Head />
                <Tailwind>
                  <Body className="bg-[#fafbfb] font-sans text-base">
                    <Container className="bg-white p-[45px] rounded-lg">
                      {children}
                    </Container>
                  </Body>
                </Tailwind>
              </Html>
            );
          }
          
           variables: {"projectDisplayName":"New Project"}</div>
        \`,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
