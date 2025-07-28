import { it } from "../../../../../helpers";
import { Auth, ContactChannels, backendContext, niceBackendFetch } from "../../../../backend-helpers";

it("can't send a verification code while logged out", async ({ expect }) => {
  const { userId } = await Auth.Password.signUpWithEmail();
  const ccResponse = await niceBackendFetch("/api/v1/contact-channels?user_id=me", {
    method: "GET",
    accessType: "client",
  });

  backendContext.set({ userAuth: null });
  const response = await niceBackendFetch(`/api/v1/contact-channels/${userId}/${ccResponse.body.items[0].id}/send-verification-code`, {
    method: "POST",
    accessType: "client",
    body: {
      callback_url: "http://localhost:12345",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "CANNOT_GET_OWN_USER_WITHOUT_USER",
        "error": "You have specified 'me' as a userId, but did not provide authentication for a user.",
      },
      "headers": Headers {
        "x-stack-known-error": "CANNOT_GET_OWN_USER_WITHOUT_USER",
        <some fields may have been hidden>,
      },
    }
  `);
});


it("should send a verification code per e-mail", async ({ expect }) => {
  await Auth.Password.signUpWithEmail();
  await ContactChannels.sendVerificationCode();
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
  const ccResponse = await ContactChannels.getTheOnlyContactChannel();
  const response = await niceBackendFetch(`/api/v1/contact-channels/me/${ccResponse.id}/send-verification-code`, {
    method: "POST",
    accessType: "client",
    body: {
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
