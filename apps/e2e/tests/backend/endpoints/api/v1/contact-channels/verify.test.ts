import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { it } from "../../../../../helpers";
import { Auth, ContactChannels, backendContext, niceBackendFetch } from "../../../../backend-helpers";

it("should verify user's email", async ({ expect }) => {
  await Auth.Password.signUpWithEmail();
  const userResponse1 = await niceBackendFetch("/api/v1/users/me", { accessType: "client" });
  expect(userResponse1.body.primary_email_verified).toBe(false);
  await ContactChannels.verify();
  const userResponse2 = await niceBackendFetch("/api/v1/users/me", { accessType: "client" });
  expect(userResponse2.body.primary_email_verified).toBe(true);
});

it("each verification code that was already requested can be used exactly once", async ({ expect }) => {
  // note: send-verification-code checks that you didn't already verify the email when you send the verification code, but if you request multiple at the same time you should be able to use them all
  await Auth.Password.signUpWithEmail();
  await ContactChannels.sendVerificationCode();
  await ContactChannels.sendVerificationCode();
  const mailbox = backendContext.value.mailbox;
  const messages = await mailbox.fetchMessages();
  const verifyMessages = messages.filter((message) => message.subject === "Mock subject, <Subject value={\`Verify your email at \${project.displayName}\`} />");
  const verificationCodes = verifyMessages.map((message) => message.body?.text.match(/http:\/\/localhost:12345\/some-callback-url\?code=([a-zA-Z0-9]+)/)?.[1] ?? throwErr("Verification code not found"));
  expect(verificationCodes).toHaveLength(3);

  for (const code of verificationCodes) {
    const response1 = await niceBackendFetch("/api/v1/contact-channels/verify", {
      method: "POST",
      accessType: "client",
      body: {
        code,
      },
    });
    expect(response1).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "success": true },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
    const response2 = await niceBackendFetch("/api/v1/contact-channels/verify", {
      method: "POST",
      accessType: "client",
      body: {
        code,
      },
    });
    expect(response2).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 409,
        "body": {
          "code": "VERIFICATION_CODE_ALREADY_USED",
          "error": "The verification link has already been used.",
        },
        "headers": Headers {
          "x-stack-known-error": "VERIFICATION_CODE_ALREADY_USED",
          <some fields may have been hidden>,
        },
      }
    `);
  }
});

it("should not allow verify a code that doesn't exist", async ({ expect }) => {
  await Auth.Password.signUpWithEmail();
  const response = await niceBackendFetch("/api/v1/contact-channels/verify", {
    method: "POST",
    accessType: "client",
    body: {
      code: "invalid-attempt-code-123123123123123123123123",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": {
        "code": "VERIFICATION_CODE_NOT_FOUND",
        "error": "The verification code does not exist for this project.",
      },
      "headers": Headers {
        "x-stack-known-error": "VERIFICATION_CODE_NOT_FOUND",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should not allow verification of a code that is sent from a different endpoint", async ({ expect }) => {
  await Auth.Otp.sendSignInCode();
  const mailbox = backendContext.value.mailbox;
  const messages = await mailbox.fetchMessages();
  const verifyMessage = messages.find((message) => message.subject.includes("Sign in"));
  const verificationCode = verifyMessage?.body?.text.match(/http:\/\/localhost:12345\/some-callback-url\?code=([a-zA-Z0-9]+)/)?.[1] ?? throwErr("Verification code not found");

  // Try to verify the magic link code using the contact channels verification endpoint
  const verifyResponse = await niceBackendFetch("/api/v1/contact-channels/verify", {
    method: "POST",
    accessType: "client",
    body: {
      code: verificationCode,
    },
  });

  // Expect the verification to fail
  expect(verifyResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": {
        "code": "VERIFICATION_CODE_NOT_FOUND",
        "error": "The verification code does not exist for this project.",
      },
      "headers": Headers {
        "x-stack-known-error": "VERIFICATION_CODE_NOT_FOUND",
        <some fields may have been hidden>,
      },
    }
  `);
});
