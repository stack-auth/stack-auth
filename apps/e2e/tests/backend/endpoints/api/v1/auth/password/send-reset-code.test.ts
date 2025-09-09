import { it, localRedirectUrl } from "../../../../../../helpers";
import { Auth, backendContext, niceBackendFetch } from "../../../../../backend-helpers";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";

it("should send a password reset code per e-mail", async ({ expect }) => {
  await Auth.Password.signUpWithEmail();
  await Auth.signOut();
  const mailbox = backendContext.value.mailbox;
  const response = await niceBackendFetch("/api/v1/auth/password/send-reset-code", {
    method: "POST",
    accessType: "client",
    body: {
      email: mailbox.emailAddress,
      callback_url: localRedirectUrl,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": "maybe, only if user with e-mail exists" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  await wait(1000);
  const messages = await backendContext.value.mailbox.fetchMessages({ noBody: true });
  expect(messages.length).toBe(2);
  expect(messages.find(m => m.subject.includes("Verify your email at Stack Dashboard"))).toMatchInlineSnapshot(`
    MailboxMessage {
      "from": "Stack Dashboard <noreply@example.com>",
      "subject": "Verify your email at Stack Dashboard",
      "to": ["<default-mailbox--<stripped UUID>@stack-generated.example.com>"],
      <some fields may have been hidden>,
    }
  `);
  expect(messages.find(m => m.subject.includes("Reset your password at Stack Dashboard"))).toMatchInlineSnapshot(`
    MailboxMessage {
      "from": "Stack Dashboard <noreply@example.com>",
      "subject": "Reset your password at Stack Dashboard",
      "to": ["<default-mailbox--<stripped UUID>@stack-generated.example.com>"],
      <some fields may have been hidden>,
    }
  `);
});

it("should not send a password reset code to an e-mail that hasn't signed up, but should return 200 regardless", async ({ expect }) => {
  const mailbox = backendContext.value.mailbox;
  const response = await niceBackendFetch("/api/v1/auth/password/send-reset-code", {
    method: "POST",
    accessType: "client",
    body: {
      email: mailbox.emailAddress,
      callback_url: localRedirectUrl,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": "maybe, only if user with e-mail exists" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  expect(await backendContext.value.mailbox.fetchMessages({ noBody: true })).toMatchInlineSnapshot(`[]`);
});

it("should send a password reset code even if the user signed up with magic link", async ({ expect }) => {
  await Auth.Otp.signIn();
  await Auth.signOut();
  const mailbox = backendContext.value.mailbox;
  const response = await niceBackendFetch("/api/v1/auth/password/send-reset-code", {
    method: "POST",
    accessType: "client",
    body: {
      email: mailbox.emailAddress,
      callback_url: localRedirectUrl,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": "maybe, only if user with e-mail exists" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it('should not send a password reset code if the redirect URL is invalid', async ({ expect }) => {
  await Auth.Password.signUpWithEmail();
  await Auth.signOut();
  const mailbox = backendContext.value.mailbox;
  const response = await niceBackendFetch("/api/v1/auth/password/send-reset-code", {
    method: "POST",
    accessType: "client",
    body: {
      email: mailbox.emailAddress,
      callback_url: "http://evil-website.example.com",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "REDIRECT_URL_NOT_WHITELISTED",
        "error": "Redirect URL not whitelisted. Did you forget to add this domain to the trusted domains list on the Stack Auth dashboard?",
      },
      "headers": Headers {
        "x-stack-known-error": "REDIRECT_URL_NOT_WHITELISTED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it.todo("should not send a password reset code if the project does not have password authentication enabled");

it.todo("should not send a password reset code if the user does not have e-mail authentication enabled");
