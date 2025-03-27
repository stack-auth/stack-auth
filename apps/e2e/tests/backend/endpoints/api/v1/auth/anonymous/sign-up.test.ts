import { it } from "../../../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../../../backend-helpers";

it("allows anonymous users to sign up on the internal project", async ({ expect }) => {
  await Auth.Anonymous.signUp();
  const me = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
  });
  expect(me).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "auth_with_email": false,
        "client_metadata": null,
        "client_read_only_metadata": null,
        "display_name": "Anonymous user",
        "has_password": false,
        "id": "<stripped UUID>",
        "is_anonymous": true,
        "oauth_providers": [],
        "otp_auth_enabled": false,
        "passkey_auth_enabled": false,
        "primary_email": null,
        "primary_email_verified": false,
        "profile_image_url": null,
        "requires_totp_mfa": false,
        "selected_team": null,
        "selected_team_id": null,
        "signed_up_at_millis": <stripped field 'signed_up_at_millis'>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("does not allow anonymous users to sign up on newly created projects", async ({ expect }) => {
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
