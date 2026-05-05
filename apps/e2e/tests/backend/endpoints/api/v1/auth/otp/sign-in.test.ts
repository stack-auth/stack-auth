import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { it } from "../../../../../../helpers";
import { Auth, Project, backendContext, niceBackendFetch } from "../../../../../backend-helpers";

it("should sign up new users and sign in existing users", async ({ expect }) => {
  const res1 = await Auth.Otp.signIn();
  expect(res1.signInResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "access_token": <stripped field 'access_token'>,
        "is_new_user": true,
        "refresh_token": <stripped field 'refresh_token'>,
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  const res2 = await Auth.Otp.signIn();
  expect(res2.signInResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "access_token": <stripped field 'access_token'>,
        "is_new_user": false,
        "refresh_token": <stripped field 'refresh_token'>,
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should sign in users created with the server API", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/users", {
    accessType: "server",
    method: "POST",
    body: {
      primary_email: backendContext.value.mailbox.emailAddress,
      primary_email_auth_enabled: true,
      primary_email_verified: true,
    },
  });
  expect(response.status).toBe(201);
  const res2 = await Auth.Otp.signIn();
  expect(res2.signInResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "access_token": <stripped field 'access_token'>,
        "is_new_user": false,
        "refresh_token": <stripped field 'refresh_token'>,
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should sign in users created with the server API even if sign up is disabled", async ({ expect }) => {
  await Project.createAndSwitch({ config: { sign_up_enabled: false, magic_link_enabled: true } });
  const response = await niceBackendFetch("/api/v1/users", {
    accessType: "server",
    method: "POST",
    body: {
      primary_email: backendContext.value.mailbox.emailAddress,
      primary_email_auth_enabled: true,
      primary_email_verified: true,
    },
  });
  expect(response.status).toBe(201);
  const res2 = await Auth.Otp.signIn();
  expect(res2.signInResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "access_token": <stripped field 'access_token'>,
        "is_new_user": false,
        "refresh_token": <stripped field 'refresh_token'>,
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should not allow signing in if email is not verified", async ({ expect }) => {
  await niceBackendFetch("/api/v1/users", {
    accessType: "server",
    method: "POST",
    body: {
      primary_email: backendContext.value.mailbox.emailAddress,
      primary_email_auth_enabled: true,
      primary_email_verified: false,
    },
  });

  const response = await niceBackendFetch("/api/v1/auth/otp/send-sign-in-code", {
    method: "POST",
    accessType: "client",
    body: {
      email: backendContext.value.mailbox.emailAddress,
      callback_url: "http://localhost:12345/some-callback-url",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 409,
      "body": {
        "code": "USER_EMAIL_ALREADY_EXISTS",
        "details": {
          "email": "default-mailbox--<stripped UUID>@stack-generated.example.com",
          "would_work_if_email_was_verified": true,
        },
        "error": "A user with email \\"default-mailbox--<stripped UUID>@stack-generated.example.com\\" already exists but the email is not verified. Please login to your existing account with the method you used to sign up, and then verify your email to sign in with this login method.",
      },
      "headers": Headers {
        "x-stack-known-error": "USER_EMAIL_ALREADY_EXISTS",
        <some fields may have been hidden>,
      },
    }
  `);
});


it("should sign up a new user even if one already exists with email auth disabled", async ({ expect }) => {
  await niceBackendFetch("/api/v1/users", {
    accessType: "server",
    method: "POST",
    body: {
      primary_email: backendContext.value.mailbox.emailAddress,
      primary_email_auth_enabled: false,
      primary_email_verified: true,
    },
  });
  const res2 = await Auth.Otp.signIn();
  expect(res2.signInResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "access_token": <stripped field 'access_token'>,
        "is_new_user": true,
        "refresh_token": <stripped field 'refresh_token'>,
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should not allow signing in when MFA is required", async ({ expect }) => {
  await Auth.Otp.signIn();
  await Auth.Mfa.setupTotpMfa();
  await Auth.signOut();

  const mailbox = backendContext.value.mailbox;
  await Auth.Otp.sendSignInCode();
  const messages = await mailbox.waitForMessagesWithSubject("Sign in to");
  const message = messages.findLast((message) => message.subject.includes("Sign in to")) ?? throwErr("Sign-in code message not found");
  const signInCode = message.body?.text.match(/http:\/\/localhost:12345\/some-callback-url\?code=([a-zA-Z0-9]+)/)?.[1] ?? throwErr("Sign-in URL not found");
  const response = await niceBackendFetch("/api/v1/auth/otp/sign-in", {
    method: "POST",
    accessType: "client",
    body: {
      code: signInCode,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "MULTI_FACTOR_AUTHENTICATION_REQUIRED",
        "details": { "attempt_code": <stripped field 'attempt_code'> },
        "error": "Multi-factor authentication is required for this user.",
      },
      "headers": Headers {
        "x-stack-known-error": "MULTI_FACTOR_AUTHENTICATION_REQUIRED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should sign in with otp code", async ({ expect }) => {
  await Auth.Otp.sendSignInCode();
  const mailbox = backendContext.value.mailbox;
  const sendSignInCodeResponse = await niceBackendFetch("/api/v1/auth/otp/send-sign-in-code", {
    method: "POST",
    accessType: "client",
    body: {
      email: mailbox.emailAddress,
      callback_url: "http://localhost:12345/some-callback-url",
    },
  });

  expect(sendSignInCodeResponse.status).toBe(200);
  expect(sendSignInCodeResponse.body.nonce).toBeDefined();

  // Wait for 2 emails (one from sendSignInCode helper, one from the above call)
  const emails = await backendContext.value.mailbox.waitForMessagesWithSubjectCount("Sign in to", 2);
  const email = emails.findLast((message) => message.subject.includes("Sign in to")) ?? throwErr("Sign-in code message not found");
  const match = email.body?.html.match(/\>([A-Z0-9]{6})\<\/p\>/);

  const signInResponse = await niceBackendFetch("/api/v1/auth/otp/sign-in", {
    method: "POST",
    accessType: "client",
    body: {
      code: match?.[1] + sendSignInCodeResponse.body.nonce,
    },
  });

  expect(signInResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "access_token": <stripped field 'access_token'>,
        "is_new_user": true,
        "refresh_token": <stripped field 'refresh_token'>,
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should not sign in if code is invalid", async ({ expect }) => {
  await Auth.Otp.sendSignInCode();
  const mailbox = backendContext.value.mailbox;
  const sendSignInCodeResponse = await niceBackendFetch("/api/v1/auth/otp/send-sign-in-code", {
    method: "POST",
    accessType: "client",
    body: {
      email: mailbox.emailAddress,
      callback_url: "http://localhost:12345/some-callback-url",
    },
  });

  const signInResponse = await niceBackendFetch("/api/v1/auth/otp/sign-in", {
    method: "POST",
    accessType: "client",
    body: {
      code: 'ABC123' + sendSignInCodeResponse.body.nonce,
    },
  });

  expect(signInResponse).toMatchInlineSnapshot(`
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


it("should set the code to invalid after too many attempts", async ({ expect }) => {
  await Auth.Otp.sendSignInCode();
  const mailbox = backendContext.value.mailbox;
  const sendSignInCodeResponse = await niceBackendFetch("/api/v1/auth/otp/send-sign-in-code", {
    method: "POST",
    accessType: "client",
    body: {
      email: mailbox.emailAddress,
      callback_url: "http://localhost:12345/some-callback-url",
    },
  });

  // Wait for 2 emails (one from sendSignInCode helper, one from the above call)
  const emails = await backendContext.value.mailbox.waitForMessagesWithSubjectCount("Sign in to", 2);
  const email = emails.findLast((message) => message.subject.includes("Sign in to")) ?? throwErr("Sign-in code message not found");
  const match = email.body?.html.match(/\>([A-Z0-9]{6})\<\/p\>/);

  for (let i = 0; i < 25; i++) {
    await niceBackendFetch("/api/v1/auth/otp/sign-in", {
      method: "POST",
      accessType: "client",
      body: {
        code: 'ABC123' + sendSignInCodeResponse.body.nonce,
      },
    });
  }

  const signInResponse = await niceBackendFetch("/api/v1/auth/otp/sign-in", {
    method: "POST",
    accessType: "client",
    body: {
      code: match?.[1] + sendSignInCodeResponse.body.nonce,
    },
  });

  expect(signInResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "VERIFICATION_CODE_MAX_ATTEMPTS_REACHED",
        "error": "The verification code nonce has reached the maximum number of attempts. This code is not valid anymore.",
      },
      "headers": Headers {
        "x-stack-known-error": "VERIFICATION_CODE_MAX_ATTEMPTS_REACHED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should sign in with both codes when requesting two sign in codes before using either of them", async ({ expect }) => {
  await Auth.Otp.sendSignInCode();
  const signInCode1 = await Auth.Otp.getSignInCodeFromMailbox();
  await Auth.Otp.sendSignInCode();
  const signInCode2 = await Auth.Otp.getSignInCodeFromMailbox();

  const res1 = await Auth.Otp.signInWithCode(signInCode1);
  expect(res1.signInResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "access_token": <stripped field 'access_token'>,
        "is_new_user": true,
        "refresh_token": <stripped field 'refresh_token'>,
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const res2 = await Auth.Otp.signInWithCode(signInCode2);
  expect(res2.signInResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "access_token": <stripped field 'access_token'>,
        "is_new_user": false,
        "refresh_token": <stripped field 'refresh_token'>,
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should use the send-sign-in-code request context when creating a new OTP user", async ({ expect }) => {
  backendContext.set({
    ipData: {
      ipAddress: "127.0.0.70",
      country: "CA",
      city: "Toronto",
      region: "ON",
      latitude: 43.6532,
      longitude: -79.3832,
      tzIdentifier: "America/Toronto",
    },
  });

  const { sendSignInCodeResponse } = await Auth.Otp.sendSignInCode();
  const signInCode = await Auth.Otp.getSignInCodeFromMailbox(sendSignInCodeResponse.body.nonce);

  backendContext.set({
    ipData: {
      ipAddress: "127.0.0.71",
      country: "US",
      city: "New York",
      region: "NY",
      latitude: 40.7128,
      longitude: -74.006,
      tzIdentifier: "America/New_York",
    },
  });

  const { userId } = await Auth.Otp.signInWithCode(signInCode);
  const userResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
    method: "GET",
    accessType: "server",
  });

  expect(userResponse.status).toBe(200);
  expect(userResponse.body.country_code).toBe("CA");
});

it("should mint exactly one refresh token when the same code is redeemed in parallel", async ({ expect }) => {
  // Guards the verification-code TOCTOU fix. Before the fix, the read-then-write pattern
  // in verification-code-handler.tsx let N concurrent requests with the same OTP each pass
  // the `if (usedAt) throw` check and each call createAuthTokens, minting N independent
  // refresh tokens from one code. That enabled session-persistence: revoking one token
  // didn't kill the others (no bulk-revoke exists for passwordless users short of a
  // password change). The fix claims the code with a conditional updateMany and errors all
  // losing racers with VERIFICATION_CODE_ALREADY_USED.
  const sendSignInCodeRes = await Auth.Otp.sendSignInCode();
  const signInCode = await Auth.Otp.getSignInCodeFromMailbox(sendSignInCodeRes.sendSignInCodeResponse.body.nonce);

  const parallelCount = 5;
  const responses = await Promise.all(
    Array.from({ length: parallelCount }, () => niceBackendFetch("/api/v1/auth/otp/sign-in", {
      method: "POST",
      accessType: "client",
      body: { code: signInCode },
    })),
  );

  const successes = responses.filter(r => r.status === 200);
  const alreadyUsed = responses.filter(r => r.status === 409 && (r.body as any)?.code === "VERIFICATION_CODE_ALREADY_USED");

  expect(successes).toHaveLength(1);
  expect(successes.length + alreadyUsed.length).toBe(parallelCount);
});

it.todo("should not sign in if e-mail's usedForAuth status has changed since sign-in code was sent");

it.todo("should not sign in if account's otpEnabled status has changed since sign-in code was sent");

it.todo("should not sign up for a new account if account was deleted after sign-in code was sent");

it.todo("should verify primary e-mail");
