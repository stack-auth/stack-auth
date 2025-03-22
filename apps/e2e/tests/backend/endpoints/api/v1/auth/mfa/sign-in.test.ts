import { generateTOTP } from "@oslojs/otp";
import { it } from "../../../../../../helpers";
import { Auth, backendContext, niceBackendFetch } from "../../../../../backend-helpers";

it("should sign in users with MFA enabled", async ({ expect }) => {
  const passwordRes = await Auth.Password.signUpWithEmail();
  const { totpSecret } = await Auth.Mfa.setupTotpMfa();
  await Auth.signOut();
  const signInRes = await niceBackendFetch("/api/v1/auth/password/sign-in", {
    method: "POST",
    accessType: "client",
    body: {
      email: backendContext.value.mailbox.emailAddress,
      password: passwordRes.password,
    },
  });
  expect(signInRes).toMatchInlineSnapshot(`
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
  const totp = generateTOTP(totpSecret, 30, 6);
  const response = await niceBackendFetch("/api/v1/auth/mfa/sign-in", {
    accessType: "client",
    method: "POST",
    body: {
      code: signInRes.body.details.attempt_code,
      type: "totp",
      totp,
    },
  });
  expect(response).toMatchInlineSnapshot(`
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
  backendContext.set({
    userAuth: {
      accessToken: response.body.access_token,
      refreshToken: response.body.refresh_token,
    },
  });
  await Auth.expectToBeSignedIn();
}, {
  // the TOTP code may expire right as we try to use it
  // for this rare case, retry the test once
  retry: 1,
});

it("should reject invalid attempt codes", async ({ expect }) => {
  const passwordRes = await Auth.Password.signUpWithEmail();
  const { totpSecret } = await Auth.Mfa.setupTotpMfa();
  await Auth.signOut();
  const totp = generateTOTP(totpSecret, 30, 6);
  const response = await niceBackendFetch("/api/v1/auth/mfa/sign-in", {
    accessType: "client",
    method: "POST",
    body: {
      code: "invalid-attempt-code-123123123123123123123123",
      type: "totp",
      totp,
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


it("should reject invalid totp codes", async ({ expect }) => {
  const passwordRes = await Auth.Password.signUpWithEmail();
  const { totpSecret } = await Auth.Mfa.setupTotpMfa();
  await Auth.signOut();
  const signInRes = await niceBackendFetch("/api/v1/auth/password/sign-in", {
    method: "POST",
    accessType: "client",
    body: {
      email: backendContext.value.mailbox.emailAddress,
      password: passwordRes.password,
    },
  });
  expect(signInRes).toMatchInlineSnapshot(`
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
  const response = await niceBackendFetch("/api/v1/auth/mfa/sign-in", {
    accessType: "client",
    method: "POST",
    body: {
      code: signInRes.body.details.attempt_code,
      type: "totp",
      totp: "never-valid-totp",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "INVALID_TOTP_CODE",
        "error": "The TOTP code is invalid. Please try again.",
      },
      "headers": Headers {
        "x-stack-known-error": "INVALID_TOTP_CODE",
        <some fields may have been hidden>,
      },
    }
  `);
});
