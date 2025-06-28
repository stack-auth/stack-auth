import { it } from "../../../../helpers";
import { niceBackendFetch, Project, User } from "../../../backend-helpers";

it("unsubscribe link should be sent and update notification preference", async ({ expect }) => {
  await Project.createAndSwitch({
    display_name: "Test Successful Email Project",
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
  const response = await niceBackendFetch(
    "/api/v1/emails/send-email",
    {
      method: "POST",
      accessType: "server",
      body: {
        user_id: user.userId,
        html: "<h1>Test Email</h1><p>This is a test email with HTML content.</p>",
        subject: "Custom Test Email Subject",
        notification_category_name: "Marketing",
      }
    }
  );

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "user_email": "unindexed-mailbox--<stripped UUID>@stack-generated.example.com" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Verify the email was actually sent by checking the mailbox
  const messages = await user.mailbox.fetchMessages();
  const sentEmail = messages.find(msg => msg.subject === "Custom Test Email Subject");
  expect(sentEmail).toBeDefined();
  expect(sentEmail!.body?.html).toMatch(/<h1>Test Email<\/h1><p>This is a test email with HTML content\.<\/p><br \/><a href="http:\/\/localhost:8102\/api\/v1\/emails\/unsubscribe-link\?code=[a-zA-Z0-9]+">Click here to unsubscribe<\/a>/);

  // Extract the unsubscribe link and fetch it
  const unsubscribeLinkMatch = sentEmail!.body?.html.match(/href="([^"]+)"/);
  expect(unsubscribeLinkMatch).toBeDefined();
  const unsubscribeUrl = unsubscribeLinkMatch![1];
  const unsubscribeResponse = await niceBackendFetch(unsubscribeUrl, {
    method: "GET",
    accessType: "client",
  });
  expect(unsubscribeResponse.status).toBe(200);
  expect(unsubscribeResponse.body).toBe("<p>Successfully unsubscribed from notification group</p>");

  const listPreferencesResponse = await niceBackendFetch(
    `/api/v1/emails/notification-preference/${user.userId}`,
    {
      method: "GET",
      accessType: "admin",
    }
  );
  expect(listPreferencesResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "can_disable": false,
            "enabled": true,
            "notification_category_id": "<stripped UUID>",
            "notification_category_name": "Transactional",
          },
          {
            "can_disable": true,
            "enabled": false,
            "notification_category_id": "<stripped UUID>",
            "notification_category_name": "Marketing",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("unsubscribe link should not be sent for emails with transactional notification category", async ({ expect }) => {
  await Project.createAndSwitch({
    display_name: "Test Successful Email Project",
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
  const response = await niceBackendFetch(
    "/api/v1/emails/send-email",
    {
      method: "POST",
      accessType: "server",
      body: {
        user_id: user.userId,
        html: "<h1>Test Email</h1><p>This is a test email with HTML content.</p>",
        subject: "Custom Test Email Subject",
        notification_category_name: "Transactional",
      }
    }
  );

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "user_email": "unindexed-mailbox--<stripped UUID>@stack-generated.example.com" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const messages = await user.mailbox.fetchMessages();
  const sentEmail = messages.find(msg => msg.subject === "Custom Test Email Subject");
  expect(sentEmail).toBeDefined();
  expect(sentEmail!.body?.html).toMatchInlineSnapshot(`"<h1>Test Email</h1><p>This is a test email with HTML content.</p>\\n"`);
});
