import { expect } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../../backend-helpers";

it("should send email digest if there are failed emails", async () => {
  const { adminAccessToken, adminMailbox } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
      email_config: {
        type: 'standard',
        sender_email: 'not-actually-a-real-server@example.com',
        sender_name: 'Test',
        host: 'smtp-fail.example.com',
        port: 587,
        username: 'test',
        password: 'test',
      },
    },
  });
  await expect(Auth.Otp.signIn()).rejects.toThrow();
  await expect(Auth.Otp.signIn()).rejects.toThrow();

  const response = await niceBackendFetch("/api/latest/cron/send-email-digest", {
    method: "GET",
    accessType: "admin",
    headers: {
      'authorization': `Bearer cron-secret-placeholder`,
      'x-stack-admin-access-token': adminAccessToken,
    },
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const messages = await adminMailbox.fetchMessages({});
  expect(messages).toMatchInlineSnapshot(`
    [
      MailboxMessage {
        "attachments": [],
        "body": {
          "html": "http://localhost:12345/some-callback-url?code=%3Cstripped+query+param%3E",
          "text": "http://localhost:12345/some-callback-url?code=%3Cstripped+query+param%3E",
        },
        "from": "Stack Dashboard <noreply@example.com>",
        "subject": "Sign in to Stack Dashboard: Your code is <stripped code>",
        "to": ["<unindexed-mailbox--<stripped UUID>@stack-generated.example.com>"],
        <some fields may have been hidden>,
      },
      MailboxMessage {
        "attachments": [],
        "body": {
          "html": "",
          "text": deindent\`
            The following email addresses failed to receive messages:
            
            default-mailbox--<stripped UUID>@stack-generated.example.com
            default-mailbox--<stripped UUID>@stack-generated.example.com
            
          \` + "\\n",
        },
        "from": "Stack Dashboard <noreply@example.com>",
        "subject": "You have 2 emails that failed to deliver in your project New Project",
        "to": ["<unindexed-mailbox--<stripped UUID>@stack-generated.example.com>"],
        <some fields may have been hidden>,
      },
    ]
  `);
});

