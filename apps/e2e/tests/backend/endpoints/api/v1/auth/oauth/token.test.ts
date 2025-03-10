
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { describe } from "vitest";
import { it, localRedirectUrl } from "../../../../../../helpers";
import { Auth, backendContext, niceBackendFetch } from "../../../../../backend-helpers";

describe("with grant_type === 'authorization_code'", async () => {
  it("should sign in a user when called as part of the OAuth flow", async ({ expect }) => {
    const response = await Auth.OAuth.signIn();

    expect(response.tokenResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "access_token": <stripped field 'access_token'>,
          "afterCallbackRedirectUrl": null,
          "after_callback_redirect_url": null,
          "expires_in": 3599,
          "is_new_user": true,
          "newUser": true,
          "refresh_token": <stripped field 'refresh_token'>,
          "scope": "legacy",
          "token_type": "Bearer",
        },
        "headers": Headers {
          "pragma": "no-cache",
          <some fields may have been hidden>,
        },
      }
    `);
    await Auth.expectToBeSignedIn();
    const meResponse = await niceBackendFetch("/api/v1/users/me", { accessType: "client" });
    expect(meResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "auth_with_email": false,
          "client_metadata": null,
          "client_read_only_metadata": null,
          "display_name": null,
          "has_password": false,
          "id": "<stripped UUID>",
          "oauth_providers": [
            {
              "account_id": "default-mailbox--<stripped UUID>@stack-generated.example.com",
              "email": "default-mailbox--<stripped UUID>@stack-generated.example.com",
              "id": "spotify",
            },
          ],
          "otp_auth_enabled": false,
          "passkey_auth_enabled": false,
          "primary_email": "default-mailbox--<stripped UUID>@stack-generated.example.com",
          "primary_email_verified": true,
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

  it("should fail when called with an invalid code_challenge", async ({ expect }) => {
    const getAuthorizationCodeResult = await Auth.OAuth.getAuthorizationCode();

    const projectKeys = backendContext.value.projectKeys;
    if (projectKeys === "no-project") throw new Error("No project keys found in the backend context");

    const tokenResponse = await niceBackendFetch("/api/v1/auth/oauth/token", {
      method: "POST",
      accessType: "client",
      body: {
        client_id: projectKeys.projectId,
        client_secret: projectKeys.publishableClientKey ?? throwErr("No publishable client key found in the backend context"),
        code: getAuthorizationCodeResult.authorizationCode,
        redirect_uri: localRedirectUrl,
        code_verifier: "invalid-code-challenge",
        grant_type: "authorization_code",
      },
    });
    expect(tokenResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": {
          "code": "INVALID_AUTHORIZATION_CODE",
          "error": "The given authorization code is invalid.",
        },
        "headers": Headers {
          "x-stack-known-error": "INVALID_AUTHORIZATION_CODE",
          <some fields may have been hidden>,
        },
      }
    `);
  });

  it("should fail when called with an invalid redirect_uri", async ({ expect }) => {
    const getAuthorizationCodeResult = await Auth.OAuth.getAuthorizationCode();

    const projectKeys = backendContext.value.projectKeys;
    if (projectKeys === "no-project") throw new Error("No project keys found in the backend context");

    const tokenResponse = await niceBackendFetch("/api/v1/auth/oauth/token", {
      method: "POST",
      accessType: "client",
      body: {
        client_id: projectKeys.projectId,
        client_secret: projectKeys.publishableClientKey ?? throwErr("No publishable client key found in the backend context"),
        code: getAuthorizationCodeResult.authorizationCode,
        redirect_uri: "http://invalid-redirect-uri.example.com",
        code_verifier: "some-code-challenge",
        grant_type: "authorization_code",
      },
    });
    expect(tokenResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": {
          "code": "REDIRECT_URL_NOT_WHITELISTED",
          "error": "Redirect URL not whitelisted. Did you forget to add this domain to the trusted domains list on the Stack Auth dashboard?",
        },
        "headers": Headers {
          "x-stack-known-error": "REDIRECT_URL_NOT_WHITELISTED",
          <some fields may have been hidden>,
        },
      }
    `);
  });

  it("should fail when called with an invalid code", async ({ expect }) => {
    const getAuthorizationCodeResult = await Auth.OAuth.getAuthorizationCode();

    const projectKeys = backendContext.value.projectKeys;
    if (projectKeys === "no-project") throw new Error("No project keys found in the backend context");

    const tokenResponse = await niceBackendFetch("/api/v1/auth/oauth/token", {
      method: "POST",
      accessType: "client",
      body: {
        client_id: projectKeys.projectId,
        client_secret: projectKeys.publishableClientKey ?? throwErr("No publishable client key found in the backend context"),
        code: "invalid-code",
        redirect_uri: localRedirectUrl,
        code_verifier: "some-code-challenge",
        grant_type: "authorization_code",
      },
    });
    expect(tokenResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": {
          "code": "INVALID_AUTHORIZATION_CODE",
          "error": "The given authorization code is invalid.",
        },
        "headers": Headers {
          "x-stack-known-error": "INVALID_AUTHORIZATION_CODE",
          <some fields may have been hidden>,
        },
      }
    `);
  });

  it("should fail when MFA is required", async ({ expect }) => {
    await Auth.OAuth.signIn();
    await Auth.Mfa.setupTotpMfa();
    await Auth.signOut();

    const getAuthorizationCodeResult = await Auth.OAuth.getAuthorizationCode();

    const projectKeys = backendContext.value.projectKeys;
    if (projectKeys === "no-project") throw new Error("No project keys found in the backend context");

    const tokenResponse = await niceBackendFetch("/api/v1/auth/oauth/token", {
      method: "POST",
      accessType: "client",
      body: {
        client_id: projectKeys.projectId,
        client_secret: projectKeys.publishableClientKey ?? throwErr("No publishable client key found in the backend context"),
        code: getAuthorizationCodeResult.authorizationCode,
        redirect_uri: localRedirectUrl,
        code_verifier: "some-code-challenge",
        grant_type: "authorization_code",
      },
    });
    expect(tokenResponse).toMatchInlineSnapshot(`
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
});
