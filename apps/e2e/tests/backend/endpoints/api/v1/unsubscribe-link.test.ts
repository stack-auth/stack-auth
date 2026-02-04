import { it, niceFetch } from "../../../../helpers";
import { withPortPrefix } from "../../../../helpers/ports";
import { Auth, Project, backendContext, niceBackendFetch } from "../../../backend-helpers";

it("unsubscribe link should be sent and update notification preference", async ({ expect }) => {
  await Project.createAndSwitch({
    display_name: "Test Successful Email Project",
    config: {
      email_config: {
        type: "standard",
        host: "localhost",
        port: Number(withPortPrefix("29")),
        username: "test",
        password: "test",
        sender_name: "Test Project",
        sender_email: "test@example.com",
      },
    },
  });
  const { userId } = await Auth.Password.signUpWithEmail();
  const response = await niceBackendFetch(
    "/api/v1/emails/send-email",
    {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userId],
        html: "<h1>Test Email</h1><p>This is a test email with HTML content.</p>",
        subject: "Custom Test Email Subject",
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

  // Verify the email was actually sent by checking the mailbox
  const messages = await backendContext.value.mailbox.waitForMessagesWithSubject("Custom Test Email Subject");
  const sentEmail = messages[0];
  expect(sentEmail!.body?.html).toMatchInlineSnapshot(`"http://localhost:<$NEXT_PUBLIC_STACK_PORT_PREFIX>02/api/v1/emails/unsubscribe-link?code=%3Cstripped+query+param%3E"`);

  // Extract the unsubscribe link and fetch it
  const unsubscribeLinkMatch = sentEmail!.body?.html.match(/href="([^"]+)"/);
  expect(unsubscribeLinkMatch).toBeDefined();
  // Decode HTML entities (e.g., &amp; -> &)
  const unsubscribeUrl = unsubscribeLinkMatch![1].replace(/&amp;/g, "&");
  // Normal fetch as this is a public endpoint usually accessed via a browser
  const unsubscribeResponse = await niceFetch(unsubscribeUrl, {
    method: "GET",
  });
  expect(unsubscribeResponse.status).toBe(200);
  expect(unsubscribeResponse.body).toBe("<p>Successfully unsubscribed from notification group</p>");

  const listPreferencesResponse = await niceBackendFetch(
    `/api/v1/emails/notification-preference/${userId}`,
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
        port: Number(withPortPrefix("29")),
        username: "test",
        password: "test",
        sender_name: "Test Project",
        sender_email: "test@example.com",
      },
    },
  });
  const { userId } = await Auth.Password.signUpWithEmail();
  const response = await niceBackendFetch(
    "/api/v1/emails/send-email",
    {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userId],
        html: "<h1>Test Email</h1><p>This is a test email with HTML content.</p>",
        subject: "Custom Test Email Subject",
        notification_category_name: "Transactional",
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

  const messages = await backendContext.value.mailbox.waitForMessagesWithSubject("Custom Test Email Subject");
  const sentEmail = messages[0];
  expect(sentEmail).toBeDefined();
  expect(sentEmail!.body?.html).toMatchInlineSnapshot(`"<!DOCTYPE html PUBLIC \\"-//W3C//DTD XHTML 1.0 Transitional//EN\\" \\"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\\"><html dir=\\"ltr\\" lang=\\"en\\"><head><meta content=\\"text/html; charset=UTF-8\\" http-equiv=\\"Content-Type\\"/><meta name=\\"x-apple-disable-message-reformatting\\"/></head><body style=\\"background-color:rgb(250,251,251)\\"><!--$--><table border=\\"0\\" width=\\"100%\\" cellPadding=\\"0\\" cellSpacing=\\"0\\" role=\\"presentation\\" align=\\"center\\"><tbody><tr><td style=\\"background-color:rgb(250,251,251);font-family:ui-sans-serif,system-ui,sans-serif,&quot;Apple Color Emoji&quot;,&quot;Segoe UI Emoji&quot;,&quot;Segoe UI Symbol&quot;,&quot;Noto Color Emoji&quot;;font-size:1rem;line-height:1.5\\"><table align=\\"center\\" width=\\"100%\\" border=\\"0\\" cellPadding=\\"0\\" cellSpacing=\\"0\\" role=\\"presentation\\" style=\\"max-width:37.5em;background-color:rgb(255,255,255);padding:45px;border-radius:0.5rem\\"><tbody><tr style=\\"width:100%\\"><td><div><h1>Test Email</h1><p>This is a test email with HTML content.</p></div></td></tr></tbody></table></td></tr></tbody></table><!--7--><!--/$--></body></html>"`);
});

it("unsubscribe link should be included when template exports Marketing notification category (two-pass rendering)", async ({ expect }) => {
  await Project.createAndSwitch({
    display_name: "Test Two-Pass Rendering Project",
    config: {
      email_config: {
        type: "standard",
        host: "localhost",
        port: Number(withPortPrefix("29")),
        username: "test",
        password: "test",
        sender_name: "Test Project",
        sender_email: "test@example.com",
      },
    },
  });
  const { userId } = await Auth.Password.signUpWithEmail();

  // Create a draft with a template that exports Marketing notification category
  const marketingTemplate = `import { Container } from "@react-email/components";
import { Subject, NotificationCategory, Props } from "@stackframe/emails";

export function EmailTemplate({ user, project }: Props) {
  return (
    <Container>
      <Subject value="Two-Pass Test Subject" />
      <NotificationCategory value="Marketing" />
      <div>Hello from marketing template!</div>
    </Container>
  );
}`;

  // Using default theme (not theme_id: false) so the unsubscribe link is rendered by the theme
  const createDraftResponse = await niceBackendFetch("/api/v1/internal/email-drafts", {
    method: "POST",
    accessType: "admin",
    body: {
      display_name: "Marketing Draft",
      tsx_source: marketingTemplate,
    },
  });
  expect(createDraftResponse.status).toBe(200);
  const draftId = createDraftResponse.body.id;

  // Send email using the draft (no notification_category_name override)
  const response = await niceBackendFetch(
    "/api/v1/emails/send-email",
    {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userId],
        draft_id: draftId,
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

  // Verify the email contains an unsubscribe link (because the template exports Marketing category)
  const messages = await backendContext.value.mailbox.waitForMessagesWithSubject("Two-Pass Test Subject");
  const sentEmail = messages[0];
  expect(sentEmail).toBeDefined();
  // The email should contain an unsubscribe link since Marketing category allows unsubscribe
  expect(sentEmail!.body?.html).toContain("unsubscribe");
});

it("unsubscribe link should NOT be included when template exports Transactional notification category (two-pass rendering)", async ({ expect }) => {
  await Project.createAndSwitch({
    display_name: "Test Two-Pass Transactional Project",
    config: {
      email_config: {
        type: "standard",
        host: "localhost",
        port: Number(withPortPrefix("29")),
        username: "test",
        password: "test",
        sender_name: "Test Project",
        sender_email: "test@example.com",
      },
    },
  });
  const { userId } = await Auth.Password.signUpWithEmail();

  // Create a draft with a template that exports Transactional notification category
  // Using default theme so we can verify the theme doesn't add unsubscribe link for Transactional
  const transactionalTemplate = `import { Container } from "@react-email/components";
import { Subject, NotificationCategory, Props } from "@stackframe/emails";

export function EmailTemplate({ user, project }: Props) {
  return (
    <Container>
      <Subject value="Transactional Two-Pass Test Subject" />
      <NotificationCategory value="Transactional" />
      <div>Hello from transactional template!</div>
    </Container>
  );
}`;

  const createDraftResponse = await niceBackendFetch("/api/v1/internal/email-drafts", {
    method: "POST",
    accessType: "admin",
    body: {
      display_name: "Transactional Draft",
      tsx_source: transactionalTemplate,
    },
  });
  expect(createDraftResponse.status).toBe(200);
  const draftId = createDraftResponse.body.id;

  // Send email using the draft (no notification_category_name override)
  const response = await niceBackendFetch(
    "/api/v1/emails/send-email",
    {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userId],
        draft_id: draftId,
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

  // Verify the email does NOT contain an unsubscribe link (because the template exports Transactional category)
  const messages = await backendContext.value.mailbox.waitForMessagesWithSubject("Transactional Two-Pass Test Subject");
  const sentEmail = messages[0];
  expect(sentEmail).toBeDefined();
  // The email should NOT contain an unsubscribe link since Transactional category doesn't allow unsubscribe
  expect(sentEmail!.body?.html).not.toContain("unsubscribe");
});
