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
  expect(sentEmail!.body?.html).toContain("<h1>Test Email</h1><p>This is a test email with HTML content.</p>");
  expect(sentEmail!.body?.html).not.toContain("/api/v1/emails/unsubscribe-link");
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
