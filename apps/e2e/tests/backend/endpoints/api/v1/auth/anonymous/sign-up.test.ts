import { it } from "../../../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../../../backend-helpers";

it("allows guest sign-in on the internal project when enabled", async ({ expect }) => {
  await Auth.Anonymous.signUp();
  const me = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    headers: {
      "x-stack-allow-anonymous-user": "true",
    },
  });
  expect(me).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "auth_with_email": false,
        "client_metadata": null,
        "client_read_only_metadata": null,
        "display_name": null,
        "has_password": false,
        "id": "<stripped UUID>",
        "is_anonymous": true,
        "is_restricted": true,
        "oauth_providers": [],
        "otp_auth_enabled": false,
        "passkey_auth_enabled": false,
        "primary_email": null,
        "primary_email_verified": false,
        "profile_image_url": null,
        "requires_totp_mfa": false,
        "restricted_by_admin": false,
        "restricted_by_admin_reason": null,
        "restricted_reason": { "type": "anonymous" },
        "selected_team": {
          "client_metadata": null,
          "client_read_only_metadata": null,
          "display_name": "Personal Team",
          "id": "<stripped UUID>",
          "profile_image_url": null,
        },
        "selected_team_id": "<stripped UUID>",
        "signed_up_at_millis": <stripped field 'signed_up_at_millis'>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("allows guest sign-in on newly created projects when enabled", async ({ expect }) => {
  await Project.createAndSwitch();
  await Project.updateConfig({ "auth.anonymous.allowSignIn": true });
  const res = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
    accessType: "client",
    method: "POST",
  });
  expect(res).toMatchInlineSnapshot(`
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
});

it("allows guest sign-in even when sign-ups are disabled (independent of allowSignUp)", async ({ expect }) => {
  await Project.createAndSwitch({ config: { sign_up_enabled: false, credential_enabled: true } });
  await Project.updateConfig({ "auth.anonymous.allowSignIn": true });
  const res = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
    accessType: "client",
    method: "POST",
  });
  expect(res).toMatchInlineSnapshot(`
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
});

it("rejects guest sign-in when it is disabled (the default)", async ({ expect }) => {
  await Project.createAndSwitch();
  const res = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
    accessType: "client",
    method: "POST",
  });
  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANONYMOUS_ACCOUNTS_NOT_ENABLED",
        "error": "Anonymous accounts are not enabled for this project.",
      },
      "headers": Headers {
        "x-stack-known-error": "ANONYMOUS_ACCOUNTS_NOT_ENABLED",
        <some fields may have been hidden>,
      },
    }
  `);
});
