import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { randomUUID } from "crypto";
import { describe } from "vitest";
import { it } from "../../../../helpers";
import { niceBackendFetch, Project, User } from "../../../backend-helpers";

const testEmailConfig = {
  type: "standard",
  host: "localhost",
  port: 2500,
  username: "test",
  password: "test",
  sender_name: "Test Project",
  sender_email: "test@example.com",
} as const;

describe("invalid requests", () => {
  it("should return 401 when invalid access type is provided", async ({ expect }) => {
    const response = await niceBackendFetch(
      "/api/v1/emails/send-email",
      {
        method: "POST",
        accessType: "client",
        body: {
          user_ids: [randomUUID()],
          html: "<p>Test email</p>",
          subject: "Test Subject",
        }
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 401,
        "body": {
          "code": "INSUFFICIENT_ACCESS_TYPE",
          "details": {
            "actual_access_type": "client",
            "allowed_access_types": [
              "server",
              "admin",
            ],
          },
          "error": "The x-stack-access-type header must be 'server' or 'admin', but was 'client'.",
        },
        "headers": Headers {
          "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
          <some fields may have been hidden>,
        },
      }
    `);
  });

  it("should return 200 with user not found error in results", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Successful Email Project",
      config: {
        email_config: testEmailConfig,
      },
    });
    const user = await User.create();
    const response = await niceBackendFetch(
      "/api/v1/emails/send-email",
      {
        method: "POST",
        accessType: "server",
        body: {
          user_ids: [user.userId],
          html: "<p>Test email</p>",
          subject: "Test Subject",
          notification_category_name: "Marketing",
        }
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "results": [
            {
              "user_email": "unindexed-mailbox--<stripped UUID>@stack-generated.example.com",
              "user_id": "<stripped UUID>",
            },
          ],
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });

  it("should return 400 when using shared email config", async ({ expect }) => {
    await Project.createAndSwitch();
    const createUserResponse = await niceBackendFetch("/api/v1/users", {
      method: "POST",
      accessType: "server",
      body: {
        primary_email: "test@example.com",
      },
    });
    const response = await niceBackendFetch(
      "/api/v1/emails/send-email",
      {
        method: "POST",
        accessType: "server",
        body: {
          user_ids: [createUserResponse.body.id],
          html: "<p>Test email</p>",
          subject: "Test Subject",
          notification_category_name: "Marketing",
        }
      }
    );
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

  it("should return 400 when invalid notification category name is provided", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Successful Email Project",
      config: {
        email_config: testEmailConfig,
      },
    });
    const createUserResponse = await niceBackendFetch("/api/v1/users", {
      method: "POST",
      accessType: "server",
      body: {
        primary_email: "test@example.com",
      },
    });
    const response = await niceBackendFetch(
      "/api/v1/emails/send-email",
      {
        method: "POST",
        accessType: "server",
        body: {
          user_ids: [createUserResponse.body.id],
          html: "<p>Test email</p>",
          subject: "Test Subject",
          notification_category_name: "Invalid",
        }
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": "Notification category not found with given name",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });
});

it("should return 200 with disabled notifications error in results when user has disabled notifications for the category", async ({ expect }) => {
  await Project.createAndSwitch({
    display_name: "Test Successful Email Project",
    config: {
      email_config: testEmailConfig,
    },
  });
  const user = await User.create();

  // Disable notifications for Marketing category
  const disableNotificationsResponse = await niceBackendFetch(`/api/v1/emails/notification-preference/${user.userId}/4f6f8873-3d04-46bd-8bef-18338b1a1b4c`, {
    method: "PATCH",
    accessType: "server",
    body: {
      enabled: false,
    },
  });
  expect(disableNotificationsResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "can_disable": true,
        "enabled": false,
        "notification_category_id": "<stripped UUID>",
        "notification_category_name": "Marketing",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const response = await niceBackendFetch(
    "/api/v1/emails/send-email",
    {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [user.userId],
        html: "<p>Test email</p>",
        subject: "Test Subject",
        notification_category_name: "Marketing",
      }
    }
  );
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "results": [
          {
            "user_email": "unindexed-mailbox--<stripped UUID>@stack-generated.example.com",
            "user_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should return 200 with no primary email error in results when user does not have a primary email", async ({ expect }) => {
  await Project.createAndSwitch({
    display_name: "Test Successful Email Project",
    config: {
      email_config: testEmailConfig,
    },
  });
  const createUserResponse = await niceBackendFetch("/api/v1/users", {
    method: "POST",
    accessType: "server",
    body: {},
  });
  expect(createUserResponse.status).toBe(201);

  const response = await niceBackendFetch(
    "/api/v1/emails/send-email",
    {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [createUserResponse.body.id],
        html: "<p>Test email</p>",
        subject: "Test Subject",
        notification_category_name: "Marketing",
      }
    }
  );
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "results": [{ "user_id": "<stripped UUID>" }] },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should return 200 and send email successfully", async ({ expect }) => {
  await Project.createAndSwitch({
    display_name: "Test Successful Email Project",
    config: {
      email_config: testEmailConfig,
    },
  });
  const user = await User.create();
  const response = await niceBackendFetch(
    "/api/v1/emails/send-email",
    {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [user.userId],
        html: "<h1>Test Email</h1><p>This is a test email with HTML content.</p>",
        subject: "Custom Test Email Subject",
        notification_category_name: "Marketing",
      }
    }
  );

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "results": [
          {
            "user_email": "unindexed-mailbox--<stripped UUID>@stack-generated.example.com",
            "user_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Verify the email was actually sent by checking the mailbox
  const messages = await user.mailbox.waitForMessagesWithSubject("Custom Test Email Subject");
  expect(messages).toMatchInlineSnapshot(`
    [
      MailboxMessage {
        "attachments": [],
        "body": {
          "html": "http://localhost:8102/api/v1/emails/unsubscribe-link?code=%3Cstripped+query+param%3E",
          "text": "http://localhost:8102/api/v1/emails/unsubscribe-link?code=%3Cstripped+query+param%3E",
        },
        "from": "Test Project <test@example.com>",
        "subject": "Custom Test Email Subject",
        "to": ["<unindexed-mailbox--<stripped UUID>@stack-generated.example.com>"],
        <some fields may have been hidden>,
      },
    ]
  `);
});

it("should handle user that does not exist", async ({ expect }) => {
  await Project.createAndSwitch({
    display_name: "Test Mixed Results Project",
    config: {
      email_config: testEmailConfig,
    },
  });
  const userWithDisabledNotifications = await User.create();
  await niceBackendFetch(`/api/v1/emails/notification-preference/${userWithDisabledNotifications.userId}/4f6f8873-3d04-46bd-8bef-18338b1a1b4c`, {
    method: "PATCH",
    accessType: "server",
    body: {
      enabled: false,
    },
  });
  const nonExistentUserId = randomUUID();
  const successfulUser = await User.create();

  const response = await niceBackendFetch(
    "/api/v1/emails/send-email",
    {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userWithDisabledNotifications.userId, nonExistentUserId, successfulUser.userId],
        html: "<h1>Bulk Test Email</h1><p>This is a bulk test email.</p>",
        subject: "Bulk Test Email Subject",
        notification_category_name: "Marketing",
      }
    }
  );

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "USER_ID_DOES_NOT_EXIST",
        "details": { "user_id": "<stripped UUID>" },
        "error": "The given user with the ID <stripped UUID> does not exist.",
      },
      "headers": Headers {
        "x-stack-known-error": "USER_ID_DOES_NOT_EXIST",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should send email using a draft_id and mark draft as sent", async ({ expect }) => {
  await Project.createAndSwitch({
    display_name: "Send Draft Project",
    config: {
      email_config: {
        type: "standard",
        host: "localhost",
        port: 2500,
        username: "test",
        password: "test",
        sender_name: "Test Project",
        sender_email: "test@example.com",
      },
    },
  });
  const user = await User.create();

  const tsxSource = `import { Container } from "@react-email/components";
import { Subject, NotificationCategory, Props } from "@stackframe/emails";
export function EmailTemplate({ user, project }: Props) {
  return (
    <Container>
      <Subject value="Draft Based Subject" />
      <NotificationCategory value="Marketing" />
      <div>Hello {user.displayName}</div>
    </Container>
  );
}`;

  const createDraftRes = await niceBackendFetch("/api/v1/internal/email-drafts", {
    method: "POST",
    accessType: "admin",
    body: {
      display_name: "Welcome Draft",
      theme_id: false,
      tsx_source: tsxSource,
    },
  });
  expect(createDraftRes.status).toBe(200);
  const draftId = createDraftRes.body.id as string;

  const sendRes = await niceBackendFetch("/api/v1/emails/send-email", {
    method: "POST",
    accessType: "server",
    body: {
      user_ids: [user.userId],
      draft_id: draftId,
      subject: "Overridden Subject", // still allow explicit subject
      notification_category_name: "Marketing",
    },
  });
  expect(sendRes.status).toBe(200);
  expect(sendRes.body.results).toHaveLength(1);

  await user.mailbox.waitForMessagesWithSubject("Overridden Subject");
  const getDraftRes = await niceBackendFetch(`/api/v1/internal/email-drafts/${draftId}`, {
    method: "GET",
    accessType: "admin",
  });
  expect(getDraftRes.status).toBe(200);
  expect(getDraftRes.body.sent_at_millis).toEqual(expect.any(Number));
});

describe("validation errors", () => {
  it("should return 400 when neither html nor template_id is provided", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Validation Project",
      config: {
        email_config: testEmailConfig,
      },
    });
    const user = await User.create();
    const response = await niceBackendFetch(
      "/api/v1/emails/send-email",
      {
        method: "POST",
        accessType: "server",
        body: {
          user_ids: [user.userId],
          subject: "Test Subject",
          notification_category_name: "Marketing",
        }
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": {
          "code": "SCHEMA_ERROR",
          "details": {
            "message": deindent\`
              Request validation failed on POST /api/v1/emails/send-email:
                - body is not matched by any of the provided schemas:
                  Schema 0:
                    body.html must be defined
                  Schema 1:
                    body.template_id must be defined
                  Schema 2:
                    body.draft_id must be defined
            \`,
          },
          "error": deindent\`
            Request validation failed on POST /api/v1/emails/send-email:
              - body is not matched by any of the provided schemas:
                Schema 0:
                  body.html must be defined
                Schema 1:
                  body.template_id must be defined
                Schema 2:
                  body.draft_id must be defined
          \`,
        },
        "headers": Headers {
          "x-stack-known-error": "SCHEMA_ERROR",
          <some fields may have been hidden>,
        },
      }
    `);
  });

  it("should return 200 when empty user_ids array is provided", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Empty UserIds Project",
      config: {
        email_config: testEmailConfig,
      },
    });
    const response = await niceBackendFetch(
      "/api/v1/emails/send-email",
      {
        method: "POST",
        accessType: "server",
        body: {
          user_ids: [],
          html: "<p>Test email</p>",
          subject: "Test Subject",
          notification_category_name: "Marketing",
        }
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "results": [] },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });
});

describe("all users", () => {
  it("should return 400 when both user_ids and all_users are provided", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Both user_ids and all_users",
      config: {
        email_config: testEmailConfig,
      },
    });
    const user = await User.create();
    const response = await niceBackendFetch(
      "/api/v1/emails/send-email",
      {
        method: "POST",
        accessType: "server",
        body: {
          user_ids: [user.userId],
          all_users: true,
          html: "<p>Test email</p>",
          subject: "Test Subject",
        }
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": {
          "code": "SCHEMA_ERROR",
          "details": { "message": "Exactly one of user_ids or all_users must be provided" },
          "error": "Exactly one of user_ids or all_users must be provided",
        },
        "headers": Headers {
          "x-stack-known-error": "SCHEMA_ERROR",
          <some fields may have been hidden>,
        },
      }
    `);
  });

  it("should send one email per user when all_users is true", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test All Users Email Project",
      config: {
        email_config: testEmailConfig,
      },
    });

    const userA = await User.create();
    const userB = await User.create();
    const userC = await User.create();

    const subject = "Send to All Users Test Subject";
    const response = await niceBackendFetch(
      "/api/v1/emails/send-email",
      {
        method: "POST",
        accessType: "server",
        body: {
          all_users: true,
          html: "<p>Broadcast email to all users</p>",
          subject,
        }
      }
    );

    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "results": [
            {
              "user_email": "unindexed-mailbox--<stripped UUID>@stack-generated.example.com",
              "user_id": "<stripped UUID>",
            },
            {
              "user_email": "unindexed-mailbox--<stripped UUID>@stack-generated.example.com",
              "user_id": "<stripped UUID>",
            },
            {
              "user_email": "unindexed-mailbox--<stripped UUID>@stack-generated.example.com",
              "user_id": "<stripped UUID>",
            },
          ],
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    await userA.mailbox.waitForMessagesWithSubject(subject);
    await userB.mailbox.waitForMessagesWithSubject(subject);
    await userC.mailbox.waitForMessagesWithSubject(subject);
  });
});

describe("template-based emails", () => {
  it("should return 400 when invalid template_id is provided", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Invalid Template Project",
      config: {
        email_config: testEmailConfig,
      },
    });
    const user = await User.create();
    const response = await niceBackendFetch(
      "/api/v1/emails/send-email",
      {
        method: "POST",
        accessType: "server",
        body: {
          user_ids: [user.userId],
          template_id: randomUUID(),
          variables: { name: "Test User" },
          notification_category_name: "Marketing",
        }
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": "No template found with given template_id",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });

  it("should return 400 when invalid theme_id is provided", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Invalid Theme Project",
      config: {
        email_config: testEmailConfig,
      },
    });
    const user = await User.create();
    const response = await niceBackendFetch(
      "/api/v1/emails/send-email",
      {
        method: "POST",
        accessType: "server",
        body: {
          user_ids: [user.userId],
          html: "<p>Test email with invalid theme</p>",
          subject: "Test Subject",
          theme_id: "non-existent-theme",
          notification_category_name: "Marketing",
        }
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": {
          "code": "SCHEMA_ERROR",
          "details": {
            "message": deindent\`
              Request validation failed on POST /api/v1/emails/send-email:
                - body is not matched by any of the provided schemas:
                  Schema 0:
                    body.theme_id is invalid
                  Schema 1:
                    body.template_id must be defined
                    body.theme_id is invalid
                    body contains unknown properties: html
                    body contains unknown properties: html
                  Schema 2:
                    body.draft_id must be defined
                    body.theme_id is invalid
                    body contains unknown properties: html
                    body contains unknown properties: html
            \`,
          },
          "error": deindent\`
            Request validation failed on POST /api/v1/emails/send-email:
              - body is not matched by any of the provided schemas:
                Schema 0:
                  body.theme_id is invalid
                Schema 1:
                  body.template_id must be defined
                  body.theme_id is invalid
                  body contains unknown properties: html
                  body contains unknown properties: html
                Schema 2:
                  body.draft_id must be defined
                  body.theme_id is invalid
                  body contains unknown properties: html
                  body contains unknown properties: html
          \`,
        },
        "headers": Headers {
          "x-stack-known-error": "SCHEMA_ERROR",
          <some fields may have been hidden>,
        },
      }
    `);
  });
});

describe("notification categories", () => {
  it("should return 200 and send email successfully with Transactional category", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Transactional Project",
      config: {
        email_config: testEmailConfig,
      },
    });
    const user = await User.create();
    const response = await niceBackendFetch(
      "/api/v1/emails/send-email",
      {
        method: "POST",
        accessType: "server",
        body: {
          user_ids: [user.userId],
          html: "<p>Transactional email</p>",
          subject: "Transactional Test Subject",
          notification_category_name: "Transactional",
        }
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "results": [
            {
              "user_email": "unindexed-mailbox--<stripped UUID>@stack-generated.example.com",
              "user_id": "<stripped UUID>",
            },
          ],
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // Verify the email was sent
    await user.mailbox.waitForMessagesWithSubject("Transactional Test Subject");
  });

  it("should default to Transactional category when notification_category_name is not provided", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Default Category Project",
      config: {
        email_config: testEmailConfig,
      },
    });
    const user = await User.create();
    const response = await niceBackendFetch(
      "/api/v1/emails/send-email",
      {
        method: "POST",
        accessType: "server",
        body: {
          user_ids: [user.userId],
          html: "<p>Default category email</p>",
          subject: "Default Category Test Subject",
        }
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "results": [
            {
              "user_email": "unindexed-mailbox--<stripped UUID>@stack-generated.example.com",
              "user_id": "<stripped UUID>",
            },
          ],
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // Verify the email was sent
    await user.mailbox.waitForMessagesWithSubject("Default Category Test Subject");
  });
});
