import { it } from "../../../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../../../backend-helpers";

it("should set password", async ({ expect }) => {
  const signUpRes = await Auth.Otp.signIn();
  const response = await niceBackendFetch("/api/v1/auth/password/set", {
    method: "POST",
    accessType: "client",
    body: {
      password: "new-password",
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
  await Auth.Password.signInWithEmail({ password: "new-password" });
  await Auth.expectToBeSignedIn();
});

it("is not allowed to set password if user already has a password", async ({ expect }) => {
  await Auth.Password.signUpWithEmail();

  const response = await niceBackendFetch("/api/v1/auth/password/set", {
    method: "POST",
    accessType: "client",
    body: {
      password: "another-password",
    },
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "User already has a password set.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should not set passwords to weak passwords", async ({ expect }) => {
  const signUpRes = await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/v1/auth/password/set", {
    method: "POST",
    accessType: "client",
    body: {
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

it("should not set password if project does not have password auth enabled", async ({ expect }) => {
  await Project.createAndSwitch({ config: { credential_enabled: false, magic_link_enabled: true } });
  const signUpRes = await Auth.Otp.signIn();
  const response = await niceBackendFetch("/api/v1/auth/password/set", {
    method: "POST",
    accessType: "client",
    body: {
      password: "new-password",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "PASSWORD_AUTHENTICATION_NOT_ENABLED",
        "error": "Password authentication is not enabled for this project.",
      },
      "headers": Headers {
        "x-stack-known-error": "PASSWORD_AUTHENTICATION_NOT_ENABLED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should not update password when not logged in", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/auth/password/set", {
    method: "POST",
    accessType: "client",
    body: {
      password: "new-password",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/auth/password/set:
              - auth.user must be defined
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/auth/password/set:
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
