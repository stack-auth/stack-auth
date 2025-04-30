import { it } from "../../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../../backend-helpers";

const emptyEmailTemplate = {
  root: {
    type: 'EmailLayout',
    data: {
      backdropColor: '#F5F5F5',
      canvasColor: '#FFFFFF',
      textColor: '#262626',
      fontFamily: 'MODERN_SANS',
      childrenIds: [],
    },
  },
};


it("should not allow updating email templates when using shared email config", async ({ expect }) => {
  // Create a project with shared email config (default)
  await Auth.Otp.signIn();
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  // Try to update an email template
  const response = await niceBackendFetch("/api/v1/email-templates/password_reset", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
    body: {
      subject: "Custom Password Reset",
      content: {}, // Need to provide a valid content structure instead of text_body/html_body
    },
  });

  // Verify that the update was rejected
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Cannot update email templates in shared email config. Set up a custom email config to update email templates.",
      "headers": Headers { <some fields may have been hidden> },
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

  // Update the email template with custom content
  const customEmailContent = {
    version: 2,
    document: {
      children: [
        {
          type: "paragraph",
          children: [{ text: "Custom password reset email content" }]
        }
      ]
    }
  };

  const updateResponse = await niceBackendFetch("/api/v1/email-templates/password_reset", {
    method: "PATCH",
    accessType: "admin",
    body: {
      subject: "Custom Password Reset",
      content: emptyEmailTemplate,
    },
  });

  expect(updateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "content": {
          "root": {
            "data": {
              "backdropColor": "#F5F5F5",
              "canvasColor": "#FFFFFF",
              "childrenIds": [],
              "fontFamily": "MODERN_SANS",
              "textColor": "#262626",
            },
            "type": "EmailLayout",
          },
        },
        "is_default": false,
        "subject": "Custom Password Reset",
        "type": "password_reset",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
