import { randomUUID } from "crypto";
import { it } from "../../../../../helpers";
import { Auth, backendContext, createMailbox, niceBackendFetch, Project } from "../../../../backend-helpers";

/**
 * Tests for email normalization during authentication.
 *
 * This test suite verifies that users can sign in with both normalized and unnormalized
 * email addresses, handling the migration period where some emails in the DB are unnormalized.
 *
 * The normalization logic:
 * - Converts email to lowercase
 * - Trims whitespace
 *
 * Test scenarios cover:
 * - Password authentication
 * - Magic link (OTP) authentication
 * - OAuth account merging
 * - Password reset
 */

it("password sign-in should work with normalized email when account was created with unnormalized email", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      credential_enabled: true,
    },
  });

  // Create account with uppercase email (simulating old unnormalized data)
  const uppercaseEmail = `Test.User-${randomUUID()}@Example.COM`;
  const password = "test-password-123";

  backendContext.set({ mailbox: createMailbox(uppercaseEmail) });
  const signUpRes = await Auth.Password.signUpWithEmail({
    password,
  });
  expect(signUpRes.signUpResponse.status).toBe(200);

  await Auth.signOut();

  // Try to sign in with lowercase (normalized) email
  const normalizedEmail = uppercaseEmail.toLowerCase();
  const signInRes = await niceBackendFetch("/api/v1/auth/password/sign-in", {
    method: "POST",
    accessType: "client",
    body: {
      email: normalizedEmail,
      password,
    },
  });

  expect(signInRes.status).toBe(200);
  expect(signInRes.body).toHaveProperty("access_token");
  expect(signInRes.body).toHaveProperty("refresh_token");
  expect(signInRes.body.user_id).toBe(signUpRes.userId);
});

it("password sign-in should work with unnormalized email when account was created with normalized email", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      credential_enabled: true,
    },
  });

  // Create account with lowercase (normalized) email
  const normalizedEmail = `test.user2-${randomUUID()}@example.com`;
  const password = "test-password-456";

  backendContext.set({ mailbox: createMailbox(normalizedEmail) });
  const signUpRes = await Auth.Password.signUpWithEmail({
    password,
  });
  expect(signUpRes.signUpResponse.status).toBe(200);

  await Auth.signOut();

  // Try to sign in with uppercase (unnormalized) email
  const uppercaseEmail = normalizedEmail.toUpperCase();
  const signInRes = await niceBackendFetch("/api/v1/auth/password/sign-in", {
    method: "POST",
    accessType: "client",
    body: {
      email: uppercaseEmail,
      password,
    },
  });

  expect(signInRes.status).toBe(200);
  expect(signInRes.body).toHaveProperty("access_token");
  expect(signInRes.body.user_id).toBe(signUpRes.userId);
});

it("magic link (OTP) should work with normalized email when account was created with unnormalized email", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    },
  });

  // Create account with uppercase email
  const uppercaseEmail = `OTP.Test-${randomUUID()}@Example.COM`;
  backendContext.set({ mailbox: createMailbox(uppercaseEmail) });
  const signUpRes = await Auth.Otp.signIn();
  expect(signUpRes.signInResponse.status).toBe(200);

  await Auth.signOut();

  // Try to sign in with lowercase (normalized) email
  const normalizedEmail = uppercaseEmail.toLowerCase();
  backendContext.set({ mailbox: createMailbox(normalizedEmail) });
  const code = await Auth.Otp.sendSignInCode();
  const signInRes = await Auth.Otp.signInWithCode(await Auth.Otp.getSignInCodeFromMailbox());

  expect(signInRes.signInResponse.status).toBe(200);
  expect(signInRes.userId).toBe(signUpRes.userId);
});

it("magic link (OTP) should work with unnormalized email when account was created with normalized email", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    },
  });

  // Create account with lowercase (normalized) email
  const normalizedEmail = `otp.test2-${randomUUID()}@example.com`;
  backendContext.set({ mailbox: createMailbox(normalizedEmail) });
  const signUpRes = await Auth.Otp.signIn();
  expect(signUpRes.signInResponse.status).toBe(200);

  await Auth.signOut();

  // Try to sign in with uppercase (unnormalized) email
  const uppercaseEmail = normalizedEmail.toUpperCase();
  backendContext.set({ mailbox: createMailbox(uppercaseEmail) });
  await Auth.Otp.sendSignInCode();
  const signInRes = await Auth.Otp.signInWithCode(await Auth.Otp.getSignInCodeFromMailbox());

  expect(signInRes.signInResponse.status).toBe(200);
  expect(signInRes.userId).toBe(signUpRes.userId);
});

it("password reset should work with normalized email when account was created with unnormalized email", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      credential_enabled: true,
    },
  });

  // Create account with uppercase email
  const uppercaseEmail = `Reset.Test-${randomUUID()}@Example.COM`;
  const password = "original-password";

  backendContext.set({ mailbox: createMailbox(uppercaseEmail) });
  const signUpRes = await Auth.Password.signUpWithEmail({
    password,
  });
  expect(signUpRes.signUpResponse.status).toBe(200);

  await Auth.signOut();

  // Request password reset with normalized email
  const normalizedEmail = uppercaseEmail.toLowerCase();
  const sendResetRes = await niceBackendFetch("/api/v1/auth/password/send-reset-code", {
    method: "POST",
    accessType: "client",
    body: {
      email: normalizedEmail,
      callback_url: "http://localhost:12345/reset-password",
    },
  });

  expect(sendResetRes.status).toBe(200);

  // Get the reset code from the mailbox
  const messages = await backendContext.value.mailbox.waitForMessagesWithSubject("Reset your password at New Project");
  expect(messages).toHaveLength(1);

  // Extract code from the email
  const match = messages[0]!.body!.text.match(/code=([a-zA-Z0-9_-]+)/);
  expect(match).toBeDefined();
  const code = match?.[1];
  expect(code).toBeDefined();

  // Reset password using the code
  const newPassword = "new-password-123";
  const resetRes = await niceBackendFetch("/api/v1/auth/password/reset", {
    method: "POST",
    accessType: "client",
    body: {
      code: code!,
      password: newPassword,
    },
  });

  expect(resetRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Verify can sign in with new password
  const signInRes = await niceBackendFetch("/api/v1/auth/password/sign-in", {
    method: "POST",
    accessType: "client",
    body: {
      email: normalizedEmail,
      password: newPassword,
    },
  });

  expect(signInRes.status).toBe(200);
  expect(signInRes.body.user_id).toBe(signUpRes.userId);
});

it("password reset should work with unnormalized email when account was created with normalized email", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      credential_enabled: true,
    },
  });

  // Create account with lowercase (normalized) email
  const normalizedEmail = `reset.test2-${randomUUID()}@example.com`;
  const password = "original-password-2";

  backendContext.set({ mailbox: createMailbox(normalizedEmail) });
  const signUpRes = await Auth.Password.signUpWithEmail({
    password,
  });
  expect(signUpRes.signUpResponse.status).toBe(200);

  await Auth.signOut();

  // Request password reset with unnormalized email
  const uppercaseEmail = normalizedEmail.toUpperCase();
  const sendResetRes = await niceBackendFetch("/api/v1/auth/password/send-reset-code", {
    method: "POST",
    accessType: "client",
    body: {
      email: uppercaseEmail,
      callback_url: "http://localhost:12345/reset-password",
    },
  });

  expect(sendResetRes.status).toBe(200);

  // Get the reset code from the mailbox
  const messages = await backendContext.value.mailbox.waitForMessagesWithSubject("Reset your password at New Project");
  expect(messages).toHaveLength(1);

  // Extract code from the email
  const match = messages[0]!.body!.text.match(/code=([a-zA-Z0-9_-]+)/);
  expect(match).toBeDefined();
  const code = match?.[1];
  expect(code).toBeDefined();

  // Reset password using the code
  const newPassword = "new-password-456";
  const resetRes = await niceBackendFetch("/api/v1/auth/password/reset", {
    method: "POST",
    accessType: "client",
    body: {
      code: code!,
      password: newPassword,
    },
  });

  expect(resetRes.status).toBe(200);

  // Verify can sign in with new password using uppercased email
  const signInRes = await niceBackendFetch("/api/v1/auth/password/sign-in", {
    method: "POST",
    accessType: "client",
    body: {
      email: uppercaseEmail,
      password: newPassword,
    },
  });

  expect(signInRes.status).toBe(200);
  expect(signInRes.body.user_id).toBe(signUpRes.userId);
});

it("should not allow duplicate accounts with same normalized email", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      credential_enabled: true,
    },
  });

  // Create account with lowercase email
  const email1 = `duplicate.test-${randomUUID()}@example.com`;
  const password1 = "password-1";

  backendContext.set({ mailbox: createMailbox(email1) });
  const signUpRes1 = await Auth.Password.signUpWithEmail({
    password: password1,
  });
  expect(signUpRes1.signUpResponse.status).toBe(200);

  await Auth.signOut();

  // Try to create another account with uppercase version of same email
  const email2 = email1.toUpperCase();
  const password2 = "password-2";

  const signUpRes2 = await niceBackendFetch("/api/v1/auth/password/sign-up", {
    method: "POST",
    accessType: "client",
    body: {
      email: email2,
      password: password2,
    },
  });

  // Should fail because the normalized emails are the same
  expect(signUpRes2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 409,
      "body": {
        "code": "USER_EMAIL_ALREADY_EXISTS",
        "details": {
          "email": "duplicate.test-<stripped UUID>@example.com",
          "would_work_if_email_was_verified": false,
        },
        "error": "A user with email \\"duplicate.test-<stripped UUID>@example.com\\" already exists.",
      },
      "headers": Headers {
        "x-stack-known-error": "USER_EMAIL_ALREADY_EXISTS",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("case-insensitive email should work for sign in even with mixed case variations", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      credential_enabled: true,
    },
  });

  const randomId = randomUUID();
  const baseEmail = `mixed.case.test-${randomId}@example.com`;
  const password = "test-password-mixed";

  // Create account
  backendContext.set({ mailbox: createMailbox(baseEmail) });
  const signUpRes = await Auth.Password.signUpWithEmail({
    password,
  });
  expect(signUpRes.signUpResponse.status).toBe(200);

  await Auth.signOut();

  // Test various case variations
  const variations = [
    `MIXED.CASE.TEST-${randomId}@EXAMPLE.COM`,
    `Mixed.Case.Test-${randomId}@Example.Com`,
    `mIxEd.CaSe.TeSt-${randomId}@eXaMpLe.CoM`,
    baseEmail,
  ];

  for (const emailVariation of variations) {
    const signInRes = await niceBackendFetch("/api/v1/auth/password/sign-in", {
      method: "POST",
      accessType: "client",
      body: {
        email: emailVariation,
        password,
      },
    });

    expect(signInRes).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "access_token": <stripped field 'access_token'>,
          "refresh_token": <stripped field 'refresh_token'>,
          "user_id": "<stripped UUID>",
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  }
});
