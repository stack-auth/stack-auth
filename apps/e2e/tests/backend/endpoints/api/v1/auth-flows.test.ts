import { it } from "../../../../helpers";
import { Auth, ContactChannels, InternalApiKey, Project, backendContext, niceBackendFetch } from "../../../backend-helpers";

it("should not be able to sign in again after signing in with OTP and disabling auth", async ({ expect }) => {
  await Auth.Otp.signIn();
  const cc = await ContactChannels.getTheOnlyContactChannel();
  // disable used for auth on the contact channel
  const response1 = await niceBackendFetch(`/api/v1/contact-channels/me/${cc.id}`, {
    method: "PATCH",
    accessType: "server",
    body: {
      is_verified: false,
    },
  });
  expect(response1.status).toBe(200);

  // should not be able to sign in again
  const response2 = await niceBackendFetch("/api/v1/auth/otp/send-sign-in-code", {
    method: "POST",
    accessType: "client",
    body: {
      email: backendContext.value.mailbox.emailAddress,
      callback_url: "http://localhost:12345/some-callback-url",
    },
  });
  expect(response2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 409,
      "body": {
        "code": "USER_EMAIL_ALREADY_EXISTS",
        "details": { "email": "default-mailbox--<stripped UUID>@stack-generated.example.com" },
        "error": "A user with email \\"default-mailbox--<stripped UUID>@stack-generated.example.com\\" already exists.",
      },
      "headers": Headers {
        "x-stack-known-error": "USER_EMAIL_ALREADY_EXISTS",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should not be able to sign in with OTP anymore after signing in with password first", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
      oauth_account_merge_strategy: "allow_duplicates",
    }
  });

  await Auth.Password.signUpWithEmail({ password: "some-password" });

  const response2 = await niceBackendFetch("/api/v1/auth/otp/send-sign-in-code", {
    method: "POST",
    accessType: "client",
    body: {
      email: backendContext.value.mailbox.emailAddress,
      callback_url: "http://localhost:12345/some-callback-url",
    },
  });
  expect(response2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 409,
      "body": {
        "code": "USER_EMAIL_ALREADY_EXISTS",
        "details": { "email": "default-mailbox--<stripped UUID>@stack-generated.example.com" },
        "error": "A user with email \\"default-mailbox--<stripped UUID>@stack-generated.example.com\\" already exists.",
      },
      "headers": Headers {
        "x-stack-known-error": "USER_EMAIL_ALREADY_EXISTS",
        <some fields may have been hidden>,
      },
    }
  `);
});


it("signing in with OTP first, then signing in with OAuth, should set used_for_auth to true", async ({ expect }) => {
  await Auth.Otp.signIn();
  const cc = await ContactChannels.getTheOnlyContactChannel();
  expect(cc.is_verified).toBe(true);
  expect(cc.used_for_auth).toBe(true);

  await Auth.OAuth.signIn();
  const cc2 = await ContactChannels.getTheOnlyContactChannel();
  expect(cc2.value).toBe(cc.value);
  expect(cc2.is_verified).toBe(true);
  expect(cc2.used_for_auth).toBe(true);
});

it("signs in with password first, then signs in with oauth should give an account with used_for_auth true with the new defaults", async ({ expect }) => {
  const proj = await Project.createAndSwitch({
    config: {
      credential_enabled: true,
      oauth_account_merge_strategy: "allow_duplicates",
      oauth_providers: [{
        id: "spotify",
        type: "shared",
      }],
    }
  });
  await InternalApiKey.createAndSetProjectKeys(proj.adminAccessToken);


  await Auth.Password.signUpWithEmail({ password: "some-password" });
  const cc = await ContactChannels.getTheOnlyContactChannel();
  expect(cc.is_verified).toBe(false);
  expect(cc.used_for_auth).toBe(true);

  await Auth.OAuth.signIn();
  const cc2 = await ContactChannels.getTheOnlyContactChannel();
  expect(cc2.value).toBe(cc.value);
  expect(cc2.is_verified).toBe(true);
  expect(cc2.used_for_auth).toBe(false);
});

it("should merge accounts when signing in with OTP after OAuth sign-in and email verification", async ({ expect }) => {
  await Auth.OAuth.signIn();
  const cc = await ContactChannels.getTheOnlyContactChannel();
  await niceBackendFetch(`/api/v1/contact-channels/me/${cc.id}`, {
    method: "PATCH",
    accessType: "server",
    body: {
      is_verified: true,
    },
  });

  await Auth.Otp.signIn();
  const cc2 = await ContactChannels.getTheOnlyContactChannel();
  expect(cc2.user_id).toBeDefined();
  expect(cc2.user_id).toBe(cc.user_id);
});
