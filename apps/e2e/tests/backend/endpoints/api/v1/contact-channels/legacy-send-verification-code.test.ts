import { it } from "../../../../../helpers";
import { Auth, backendContext, niceBackendFetch } from "../../../../backend-helpers";

it("doesn't send a verification code if logged out", async ({ expect }) => {
  await Auth.Password.signUpWithEmail();
  backendContext.set({ userAuth: null });
  const response = await niceBackendFetch("/api/v1/contact-channels/send-verification-code", {
    method: "POST",
    accessType: "client",
    body: {
      email: backendContext.value.mailbox.emailAddress,
      callback_url: "http://localhost:12345",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/contact-channels/send-verification-code:
              - auth.user must be defined
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/contact-channels/send-verification-code:
            - auth.user must be defined
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});


it("should send a verification code per e-mail", async ({ expect }) => {
  await Auth.Password.signUpWithEmail();
  const mailbox = backendContext.value.mailbox;
  await niceBackendFetch(`/api/v1/contact-channels/send-verification-code`, {
    method: "POST",
    accessType: "client",
    body: {
      email: mailbox.emailAddress,
      callback_url: "http://localhost:12345/some-callback-url",
    },
  });
  expect(await backendContext.value.mailbox.fetchMessages({ noBody: true })).toMatchInlineSnapshot(`
    [
      MailboxMessage {
        "from": "Stack Dashboard <noreply@example.com>",
        "subject": "Mock subject, <Subject value={\`Verify your email at \${project.displayName}\`} />",
        "to": ["<default-mailbox--<stripped UUID>@stack-generated.example.com>"],
        <some fields may have been hidden>,
      },
      MailboxMessage {
        "from": "Stack Dashboard <noreply@example.com>",
        "subject": "Mock subject, <Subject value={\`Verify your email at \${project.displayName}\`} />",
        "to": ["<default-mailbox--<stripped UUID>@stack-generated.example.com>"],
        <some fields may have been hidden>,
      },
    ]
  `);
});


it("can't verify an e-mail that has already been verified", async ({ expect }) => {
  await Auth.Otp.signIn();  // OTP accounts are verified by default
  const response = await niceBackendFetch("/api/v1/contact-channels/send-verification-code", {
    method: "POST",
    accessType: "client",
    body: {
      email: backendContext.value.mailbox.emailAddress,
      callback_url: "http://localhost:12345",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 409,
      "body": {
        "code": "EMAIL_ALREADY_VERIFIED",
        "error": "The e-mail is already verified.",
      },
      "headers": Headers {
        "x-stack-known-error": "EMAIL_ALREADY_VERIFIED",
        <some fields may have been hidden>,
      },
    }
  `);
});
