import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { expect } from "vitest";
import { it, localRedirectUrl, localRedirectUrlRegex } from "../../../../../../helpers";
import { Auth, backendContext, niceBackendFetch } from "../../../../../backend-helpers";

async function getResetCode() {
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
  const messages = await backendContext.value.mailbox.fetchMessages();
  const messagesNoBody = await backendContext.value.mailbox.fetchMessages({ noBody: true });
  expect(messagesNoBody.at(-1)).toMatchInlineSnapshot(`
     MailboxMessage {
      "from": "Stack Dashboard <noreply@example.com>",
      "subject": "Mock subject, <Subject value=\\"{\\"Reset your password at \\" + project.displayName} />\\"",
      "to": ["<default-mailbox--<stripped UUID>@stack-generated.example.com>"],
      <some fields may have been hidden>,
    }
  `);
  const resetCodeMessage = messages.find((m) => m.subject.includes("Reset your password at")) ?? throwErr("Reset code message not found");
  const resetCodeUrls = resetCodeMessage.body?.text.match(localRedirectUrlRegex) ?? throwErr("Reset code regex not matched");
  if (resetCodeUrls.length !== 1) {
    throw new StackAssertionError(`Expected exactly one reset code link, received ${resetCodeUrls.length}`, { resetCodeMessage });
  }
  const resetCodeUrl = new URL(resetCodeUrls[0]);
  return resetCodeUrl.searchParams.get("code") ?? throwErr(`Expected reset code link to contain code query param, received ${resetCodeUrl}`);
}


it("should reset the password", async ({ expect }) => {
  await Auth.Password.signUpWithEmail();
  await Auth.signOut();
  const resetCode = await getResetCode();
  const response = await niceBackendFetch("/api/v1/auth/password/reset", {
    method: "POST",
    accessType: "client",
    body: {
      code: resetCode,
      password: "this-is-a-new-password",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  await Auth.expectToBeSignedOut();
  await Auth.Password.signInWithEmail({ password: "this-is-a-new-password" });
  await Auth.expectToBeSignedIn();
});

it("should set a password if signed up with magic link", async ({ expect }) => {
  await Auth.Otp.signIn();
  await Auth.signOut();
  const resetCode = await getResetCode();
  const response = await niceBackendFetch("/api/v1/auth/password/reset", {
    method: "POST",
    accessType: "client",
    body: {
      code: resetCode,
      password: "this-is-a-new-password",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  await Auth.expectToBeSignedOut();
  await Auth.Password.signInWithEmail({ password: "this-is-a-new-password" });
  await Auth.expectToBeSignedIn();
});

it("should not reset the password if it's too weak", async ({ expect }) => {
  await Auth.Password.signUpWithEmail();
  await Auth.signOut();
  const resetCode = await getResetCode();
  const response = await niceBackendFetch("/api/v1/auth/password/reset", {
    method: "POST",
    accessType: "client",
    body: {
      code: resetCode,
      password: "short",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "PASSWORD_TOO_SHORT",
        "details": { "min_length": 8 },
        "error": "Password too short. Minimum length is 8.",
      },
      "headers": Headers {
        "x-stack-known-error": "PASSWORD_TOO_SHORT",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should be able to check the password reset code without using it", async ({ expect }) => {
  await Auth.Password.signUpWithEmail();
  await Auth.signOut();
  const resetCode = await getResetCode();
  const checkResponse1 = await niceBackendFetch("/api/v1/auth/password/reset/check-code", {
    method: "POST",
    accessType: "client",
    body: {
      code: resetCode,
    },
  });
  expect(checkResponse1).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "is_code_valid": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  const response = await niceBackendFetch("/api/v1/auth/password/reset", {
    method: "POST",
    accessType: "client",
    body: {
      code: resetCode,
      password: "this-is-a-new-password",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  const checkResponse2 = await niceBackendFetch("/api/v1/auth/password/reset/check-code", {
    method: "POST",
    accessType: "client",
    body: {
      code: resetCode,
    },
  });
  expect(checkResponse2).toMatchInlineSnapshot(`
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
});

it.todo("should not be able to reset password if password authentication is disabled on the project after the verification code was sent");

it.todo("should not be able to reset password if email authentication is disabled on the user after the verification code was sent");

it.todo("should not reset password if primary e-mail changed since sign-in code was sent");
