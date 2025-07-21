import { it } from "../../../../../../helpers";
import { Auth, ContactChannels, InternalApiKey, Project } from "../../../../../backend-helpers";

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
