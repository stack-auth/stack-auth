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
    const userId = randomUUID();
    const response = await niceBackendFetch(
      "/api/v1/emails/send-email",
      {
        method: "POST",
        accessType: "server",
        body: {
          user_ids: [userId],
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
              "error": "User not found",
              "success": false,
              "user_id": "<stripped UUID>",
            },
          ],
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });

  it("should return 400 when using shared email config", async ({ expect }) => {
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
        "body": "Cannot send custom emails when using shared email config",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });

  it("should return 404 when invalid notification category name is provided", async ({ expect }) => {
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
        "status": 404,
        "body": "Notification category not found",
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
            "error": "User has disabled notifications for this category",
            "success": false,
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
      "body": {
        "results": [
          {
            "error": "User does not have a primary email",
            "success": false,
            "user_id": "<stripped UUID>",
          },
        ],
      },
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
              "success": true,
              "user_email": "unindexed-mailbox--<stripped UUID>@stack-generated.example.com",
              "user_id": "<stripped UUID>",
            },
          ],
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

  // Verify the email was actually sent by checking the mailbox
  const messages = await user.mailbox.fetchMessages();
  const sentEmail = messages.find(msg => msg.subject === "Custom Test Email Subject");
  expect(sentEmail).toBeDefined();
  expect(sentEmail!.body?.html).toMatchInlineSnapshot(`"http://localhost:8102/api/v1/emails/unsubscribe-link?code=%3Cstripped+query+param%3E"`);
});

it("should handle mixed results for multiple users", async ({ expect }) => {
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
      "status": 200,
      "body": {
        "results": [
          {
            "error": "User has disabled notifications for this category",
            "success": false,
            "user_id": "<stripped UUID>",
          },
          {
            "error": "User not found",
            "success": false,
            "user_id": "<stripped UUID>",
          },
          {
            "success": true,
            "user_email": "unindexed-mailbox--<stripped UUID>@stack-generated.example.com",
            "user_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Verify only the successful user received the email
  const successfulUserMessages = await successfulUser.mailbox.fetchMessages();
  const sentEmail = successfulUserMessages.find(msg => msg.subject === "Bulk Test Email Subject");
  expect(sentEmail).toBeDefined();
  expect(sentEmail!.body?.html).toMatchInlineSnapshot(`"http://localhost:8102/api/v1/emails/unsubscribe-link?code=%3Cstripped+query+param%3E"`);

  // Verify the user with disabled notifications did not receive the email
  const disabledUserMessages = await userWithDisabledNotifications.mailbox.fetchMessages();
  const disabledUserEmail = disabledUserMessages.find(msg => msg.subject === "Bulk Test Email Subject");
  expect(disabledUserEmail).toBeUndefined();
});
