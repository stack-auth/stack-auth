import { it, updateCookiesFromResponse } from "../../../../../../helpers";
import { Auth, ContactChannels, InternalApiKey, Project, backendContext, niceBackendFetch } from "../../../../../backend-helpers";

it("should allow duplicates, if the merge strategy is set to allow_duplicates", async ({ expect }) => {
  const proj = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
      oauth_account_merge_strategy: "allow_duplicates",
      oauth_providers: [{
        id: "spotify",
        type: "shared",
      }],
    }
  });
  await InternalApiKey.createAndSetProjectKeys(proj.adminAccessToken);

  await Auth.Otp.signIn();
  const cc = await ContactChannels.getTheOnlyContactChannel();
  expect(cc.is_verified).toBe(true);
  expect(cc.used_for_auth).toBe(true);

  await Auth.OAuth.signIn();
  const cc2 = await ContactChannels.getTheOnlyContactChannel();
  expect(cc2.value).toBe(cc.value);
  expect(cc2.is_verified).toBe(true);
  expect(cc2.used_for_auth).toBe(false);

  expect(cc.id).not.toBe(cc2.id);
});

it("should not allow duplicates, if the merge strategy set to raise_error", async ({ expect }) => {
  const proj = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
      oauth_account_merge_strategy: "raise_error",
      oauth_providers: [{
        id: "spotify",
        type: "shared",
      }],
    }
  });
  await InternalApiKey.createAndSetProjectKeys(proj.adminAccessToken);

  await Auth.Otp.signIn();
  const cc = await ContactChannels.getTheOnlyContactChannel();
  expect(cc.is_verified).toBe(true);
  expect(cc.used_for_auth).toBe(true);

  const { response } = await Auth.OAuth.getMaybeFailingAuthorizationCode();
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 409,
      "body": {
        "code": "CONTACT_CHANNEL_ALREADY_USED_FOR_AUTH_BY_SOMEONE_ELSE",
        "details": {
          "contact_channel_value": "default-mailbox--<stripped UUID>@stack-generated.example.com",
          "type": "email",
          "would_work_if_email_was_verified": false,
        },
        "error": "This email \\"(default-mailbox--<stripped UUID>@stack-generated.example.com)\\" is already used for authentication by another account.",
      },
      "headers": Headers {
        "set-cookie": <deleting cookie 'stack-oauth-inner-<stripped cookie name key>' at path '/'>,
        "x-stack-known-error": "CONTACT_CHANNEL_ALREADY_USED_FOR_AUTH_BY_SOMEONE_ELSE",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should merge accounts, if the merge strategy set to link_method", async ({ expect }) => {
  const proj = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
      oauth_account_merge_strategy: "link_method",
      oauth_providers: [{
        id: "spotify",
        type: "shared",
      }],
    }
  });
  await InternalApiKey.createAndSetProjectKeys(proj.adminAccessToken);

  await Auth.Otp.signIn();
  const cc = await ContactChannels.getTheOnlyContactChannel();
  expect(cc.is_verified).toBe(true);
  expect(cc.used_for_auth).toBe(true);

  await Auth.OAuth.signIn();
  const cc2 = await ContactChannels.getTheOnlyContactChannel();
  expect(cc2.value).toBe(cc.value);
  expect(cc2.is_verified).toBe(true);
  expect(cc2.used_for_auth).toBe(true);

  expect(cc.id).toBe(cc2.id);
});

it("should not merge accounts if the merge strategy is set to link_method, but the old account was not verified", async ({ expect }) => {
  const proj = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
      oauth_account_merge_strategy: "link_method",
      oauth_providers: [{
        id: "spotify",
        type: "shared",
      }],
    }
  });
  await InternalApiKey.createAndSetProjectKeys(proj.adminAccessToken);

  await Auth.Password.signUpWithEmail();
  const cc = await ContactChannels.getTheOnlyContactChannel();
  expect(cc.is_verified).toBe(false);
  expect(cc.used_for_auth).toBe(true);

  const { response } = await Auth.OAuth.getMaybeFailingAuthorizationCode();
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 409,
      "body": {
        "code": "CONTACT_CHANNEL_ALREADY_USED_FOR_AUTH_BY_SOMEONE_ELSE",
        "details": {
          "contact_channel_value": "default-mailbox--<stripped UUID>@stack-generated.example.com",
          "type": "email",
          "would_work_if_email_was_verified": true,
        },
        "error": "This email \\"(default-mailbox--<stripped UUID>@stack-generated.example.com)\\" is already used for authentication by another account but the email is not verified. Please login to your existing account with the method you used to sign up, and then verify your email to sign in with this login method.",
      },
      "headers": Headers {
        "set-cookie": <deleting cookie 'stack-oauth-inner-<stripped cookie name key>' at path '/'>,
        "x-stack-known-error": "CONTACT_CHANNEL_ALREADY_USED_FOR_AUTH_BY_SOMEONE_ELSE",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should allow OAuth login with manually created account when sign-ups are disabled", async ({ expect }) => {
  // Create a project with sign-ups disabled and OAuth provider configured
  const proj = await Project.createAndSwitch({
    config: {
      sign_up_enabled: false,
      oauth_account_merge_strategy: "link_method",
      oauth_providers: [{
        id: "spotify",
        type: "shared",
      }],
    },
  });
  await InternalApiKey.createAndSetProjectKeys(proj.adminAccessToken);

  // Get the default mailbox email that will be used by mock OAuth
  const spotifyMockEmail = backendContext.value.mailbox.emailAddress;

  // Manually create a user account with that email address with auth enabled
  const createUserResponse = await niceBackendFetch("/api/v1/users", {
    method: "POST",
    accessType: "admin",
    body: {
      primary_email: spotifyMockEmail,
      primary_email_verified: true,
      primary_email_auth_enabled: true,
      display_name: "Manual User",
    },
  });

  expect(createUserResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "auth_with_email": false,
        "client_metadata": null,
        "client_read_only_metadata": null,
        "display_name": "Manual User",
        "has_password": false,
        "id": "<stripped UUID>",
        "is_anonymous": false,
        "last_active_at_millis": <stripped field 'last_active_at_millis'>,
        "oauth_providers": [],
        "otp_auth_enabled": false,
        "passkey_auth_enabled": false,
        "primary_email": "default-mailbox--<stripped UUID>@stack-generated.example.com",
        "primary_email_auth_enabled": true,
        "primary_email_verified": true,
        "profile_image_url": null,
        "requires_totp_mfa": false,
        "selected_team": null,
        "selected_team_id": null,
        "server_metadata": null,
        "signed_up_at_millis": <stripped field 'signed_up_at_millis'>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const createdUserId = createUserResponse.body.id;

  // Now try to sign in via OAuth with the same email
  // This should succeed even though sign-ups are disabled
  // because we're linking to an existing account with matching email
  const { authorizeResponse, innerCallbackUrl } = await Auth.OAuth.getInnerCallbackUrl();
  const cookie = updateCookiesFromResponse("", authorizeResponse);

  const oauthCallbackResponse = await niceBackendFetch(innerCallbackUrl.toString(), {
    redirect: "manual",
    headers: {
      cookie,
    },
  });

  const { tokenResponse } = await Auth.OAuth.signIn();
  expect(tokenResponse.body.is_new_user).toBe(false);

  const getUserResponse = await niceBackendFetch(`/api/v1/users/${createdUserId}`, {
    method: "GET",
    accessType: "admin",
  });
  expect(getUserResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "auth_with_email": false,
        "client_metadata": null,
        "client_read_only_metadata": null,
        "display_name": "Manual User",
        "has_password": false,
        "id": "<stripped UUID>",
        "is_anonymous": false,
        "last_active_at_millis": <stripped field 'last_active_at_millis'>,
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
        "primary_email_auth_enabled": true,
        "primary_email_verified": true,
        "profile_image_url": null,
        "requires_totp_mfa": false,
        "selected_team": null,
        "selected_team_id": null,
        "server_metadata": null,
        "signed_up_at_millis": <stripped field 'signed_up_at_millis'>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
