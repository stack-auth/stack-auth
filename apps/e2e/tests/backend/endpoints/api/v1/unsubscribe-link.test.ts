import { wait } from "@stackframe/stack-shared/dist/utils/promises";
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
  const sentEmail = messages[0];
  expect(sentEmail!.body?.html).toMatchInlineSnapshot(`"http://localhost:8102/api/v1/emails/unsubscribe-link?code=%3Cstripped+query+param%3E"`);

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
        user_ids: [user.userId],
        html: "<h1>Test Email</h1><p>This is a test email with HTML content.</p>",
        subject: "Custom Test Email Subject",
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

  const messages = await user.mailbox.waitForMessagesWithSubject("Custom Test Email Subject");
  const sentEmail = messages[0];
  expect(sentEmail).toBeDefined();
  expect(sentEmail!.body?.html).toMatchInlineSnapshot(`"<!DOCTYPE html PUBLIC \\"-//W3C//DTD XHTML 1.0 Transitional//EN\\" \\"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\\"><html dir=\\"ltr\\" lang=\\"en\\"><head><meta content=\\"text/html; charset=UTF-8\\" http-equiv=\\"Content-Type\\"/><meta name=\\"x-apple-disable-message-reformatting\\"/></head><body style=\\"background-color:rgb(250,251,251);font-family:ui-sans-serif, system-ui, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;;font-size:1rem;line-height:1.5rem\\"><!--$--><table align=\\"center\\" width=\\"100%\\" border=\\"0\\" cellPadding=\\"0\\" cellSpacing=\\"0\\" role=\\"presentation\\" style=\\"background-color:rgb(255,255,255);padding:45px;border-radius:0.5rem;max-width:37.5em\\"><tbody><tr style=\\"width:100%\\"><td><div><h1>Test Email</h1><p>This is a test email with HTML content.</p></div></td></tr></tbody></table><!--7--><!--/$--></body></html>"`);
});
