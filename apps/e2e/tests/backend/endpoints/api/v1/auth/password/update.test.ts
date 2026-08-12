import { it } from "../../../../../../helpers";
import { Auth, backendContext, niceBackendFetch } from "../../../../../backend-helpers";

it("should update existing passwords", async ({ expect }) => {
  const signUpRes = await Auth.Password.signUpWithEmail();
  const oldPassword = signUpRes.password;
  const newPassword = "new-password";
  const response = await niceBackendFetch("/api/v1/auth/password/update", {
    method: "POST",
    accessType: "client",
    body: {
      old_password: oldPassword,
      new_password: newPassword,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  await Auth.signOut();
  await Auth.Password.signInWithEmail({ password: newPassword });
  await Auth.expectToBeSignedIn();
});

it("should sign out other sessions but not own session when updating password", async ({ expect }) => {
  const signUpRes = await Auth.Password.signUpWithEmail();
  const oldPassword = signUpRes.password;
  const newPassword = "new-password";

  const otherSessionAuth = {
    ...backendContext.value.userAuth,
    accessToken: undefined,
  };
  backendContext.set({ userAuth: otherSessionAuth });
  await Auth.expectSessionToBeValid();
  backendContext.set({ userAuth: null });

  await Auth.Password.signInWithEmail({ password: oldPassword });
  await Auth.expectToBeSignedIn();

  const response = await niceBackendFetch("/api/v1/auth/password/update", {
    method: "POST",
    accessType: "client",
    body: {
      old_password: oldPassword,
      new_password: newPassword,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  await Auth.expectSessionToBeValid();
  await Auth.expectToBeSignedIn();  // shouldn't sign out own session

  backendContext.set({ userAuth: otherSessionAuth });
  await Auth.expectSessionToBeInvalid();
});

it("should not update passwords to weak passwords", async ({ expect }) => {
  const signUpRes = await Auth.Password.signUpWithEmail();
  const oldPassword = signUpRes.password;
  const newPassword = "short";
  const response = await niceBackendFetch("/api/v1/auth/password/update", {
    method: "POST",
    accessType: "admin",
    body: {
      old_password: oldPassword,
      new_password: newPassword,
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

it("should not update passwords without old password", async ({ expect }) => {
  await Auth.Password.signUpWithEmail();
  const newPassword = "new-password";
  const response = await niceBackendFetch("/api/v1/auth/password/update", {
    method: "POST",
    accessType: "admin",
    body: {
      new_password: newPassword,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/auth/password/update:
              - body.old_password must be defined
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/auth/password/update:
            - body.old_password must be defined
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should not update passwords if the provided old password is wrong", async ({ expect }) => {
  await Auth.Password.signUpWithEmail();
  const newPassword = "new-password";
  const response = await niceBackendFetch("/api/v1/auth/password/update", {
    method: "POST",
    accessType: "client",
    body: {
      old_password: "wrong-password",
      new_password: newPassword,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "PASSWORD_CONFIRMATION_MISMATCH",
        "error": "Passwords do not match.",
      },
      "headers": Headers {
        "x-stack-known-error": "PASSWORD_CONFIRMATION_MISMATCH",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should not update passwords if the user does not have password authentication enabled", async ({ expect }) => {
  await Auth.Otp.signIn();
  const newPassword = "new-password";
  const response = await niceBackendFetch("/api/v1/auth/password/update", {
    method: "POST",
    accessType: "client",
    body: {
      old_password: "wrong-password",
      new_password: newPassword,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "USER_DOES_NOT_HAVE_PASSWORD",
        "error": "This user does not have password authentication enabled.",
      },
      "headers": Headers {
        "x-stack-known-error": "USER_DOES_NOT_HAVE_PASSWORD",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should not update password when not logged in", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/auth/password/update", {
    method: "POST",
    accessType: "client",
    body: {
      old_password: "something-123",
      new_password: "other-thing-123",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/auth/password/update:
              - auth.user must be defined
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/auth/password/update:
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
