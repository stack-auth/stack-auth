import { it } from "../../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../../backend-helpers";

it("should reject template creation with shared email config", async ({ expect }) => {
  await Auth.fastSignUp();
  const { adminAccessToken } = await Project.createAndGetAdminToken();
  // No custom email config - uses shared

  const createResponse = await niceBackendFetch("/api/v1/internal/email-templates", {
    method: "POST",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      display_name: "Test Template Shared Email",
    },
  });

  expect(createResponse).toMatchInlineSnapshot(`
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

it("should allow template creation with custom email config", async ({ expect }) => {
  await Auth.fastSignUp();
  const { adminAccessToken } = await Project.createAndSwitch({
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

  const createResponse = await niceBackendFetch("/api/v1/internal/email-templates", {
    method: "POST",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      display_name: "Test Template Custom Email",
    },
  });

  expect(createResponse.status).toBe(200);
  expect(createResponse.body.id).toBeDefined();

  // Verify the template is in the list
  const listResponse = await niceBackendFetch("/api/v1/internal/email-templates", {
    method: "GET",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });

  const found = listResponse.body?.templates?.find((t: any) => t.id === createResponse.body?.id);
  expect(found).toBeDefined();
  expect(found.display_name).toBe("Test Template Custom Email");
});
