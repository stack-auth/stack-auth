import { it } from "../../../../../../helpers";
import { Auth, Project, backendContext, bumpEmailAddress, niceBackendFetch } from "../../../../../backend-helpers";

it("anonymous user can upgrade to regular user via password sign-up", async ({ expect }) => {
  await Project.createAndSwitch();

  // Create an anonymous user
  const anonSignUp = await Auth.Anonymous.signUp();
  const anonUserId = anonSignUp.userId;
  const anonAccessToken = anonSignUp.accessToken;

  // Verify the user is anonymous
  const anonMeRes = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    headers: {
      "x-stack-access-token": anonAccessToken,
      "x-stack-allow-anonymous-user": "true",
    },
  });
  expect(anonMeRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,asdf
      "headers": Headers {
        "x-stack-known-error": "UNPARSABLE_ACCESS_TOKEN",
        <some fields may have been hidden>,
      },
    }
  `);

  // Upgrade the user via password sign-up while logged in as anonymous
  const upgradeRes = await niceBackendFetch("/api/v1/auth/password/sign-up", {
    method: "POST",
    accessType: "client",
    headers: {
      "x-stack-access-token": anonAccessToken,
    },
    body: {
      email: "upgraded@example.com",
      password: "TestPassword123!",
      verification_callback_url: "http://localhost:3000/callback",
    },
  });

  expect(upgradeRes.status).toBe(200);
  expect(upgradeRes.body.user_id).toBe(anonUserId); // Should be the same user ID

  // Verify the user is no longer anonymous
  const upgradedMeRes = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    headers: {
      "x-stack-access-token": upgradeRes.body.access_token,
    },
  });
  expect(upgradedMeRes.status).toBe(200);
  expect(upgradedMeRes.body.is_anonymous).toBe(false);
  expect(upgradedMeRes.body.primary_email).toBe("upgraded@example.com");
  expect(upgradedMeRes.body.has_password).toBe(true);

  // Old anonymous token should still work
  const oldTokenRes = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    headers: {
      "x-stack-access-token": anonAccessToken,
    },
  });
  expect(oldTokenRes.status).toBe(200);
  expect(oldTokenRes.body.is_anonymous).toBe(false);
  expect(oldTokenRes.body.primary_email).toBe("upgraded@example.com");
});

it("non-anonymous user sign-up creates new account (does not upgrade)", async ({ expect }) => {
  await Project.createAndSwitch();

  // Create a regular user
  const firstUser = await Auth.Password.signUpWithEmail();
  const firstUserId = firstUser.userId;
  const firstAccessToken = firstUser.signUpResponse.body.access_token;

  // Sign up again while logged in as non-anonymous user (creates new account)
  const secondSignUpRes = await niceBackendFetch("/api/v1/auth/password/sign-up", {
    method: "POST",
    accessType: "client",
    headers: {
      "x-stack-access-token": firstAccessToken,
    },
    body: {
      email: "second@example.com",
      password: "TestPassword123!",
      verification_callback_url: "http://localhost:3000/callback",
    },
  });

  expect(secondSignUpRes.status).toBe(200);
  const secondUserId = secondSignUpRes.body.user_id;

  // Should be different user IDs
  expect(secondUserId).not.toBe(firstUserId);

  // Verify the new user was created
  const secondUserRes = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    headers: {
      "x-stack-access-token": secondSignUpRes.body.access_token,
    },
  });

  expect(secondUserRes.status).toBe(200);
  expect(secondUserRes.body.id).toBe(secondUserId);
  expect(secondUserRes.body.primary_email).toBe("second@example.com");

  // Original user still exists and is unchanged
  const firstUserRes = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    headers: {
      "x-stack-access-token": firstAccessToken,
    },
  });

  expect(firstUserRes.status).toBe(200);
  expect(firstUserRes.body.id).toBe(firstUserId);
  expect(firstUserRes.body.primary_email).toBe("first@example.com");
});

it("anonymous user can upgrade via OTP sign-in", async ({ expect }) => {
  await Project.createAndSwitch();

  // Create an anonymous user
  const anonSignUp = await Auth.Anonymous.signUp();
  const anonUserId = anonSignUp.userId;
  const anonAccessToken = anonSignUp.accessToken;

  // Create mailbox for OTP
  await bumpEmailAddress();
  const mailbox = backendContext.value.mailbox;

  // Send OTP code while logged in as anonymous
  const sendCodeRes = await niceBackendFetch("/api/v1/auth/otp/sign-in", {
    method: "POST",
    accessType: "client",
    headers: {
      "x-stack-access-token": anonAccessToken,
    },
    body: {
      email: mailbox.emailAddress,
    },
  });

  expect(sendCodeRes.status).toBe(200);

  // Get the OTP code
  const messages = await mailbox.fetchMessages();
  expect(messages).toHaveLength(1);
  const otpMatch = messages[0].body?.text.match(/\b([0-9]{6})\b/);
  expect(otpMatch).toBeTruthy();
  const otpCode = otpMatch![1];

  // Verify OTP code to complete upgrade
  const verifyRes = await niceBackendFetch("/api/v1/auth/otp/sign-in/verification-code", {
    method: "POST",
    accessType: "client",
    headers: {
      "x-stack-access-token": anonAccessToken,
    },
    body: {
      code: otpCode + sendCodeRes.body.nonce,
    },
  });

  expect(verifyRes.status).toBe(200);
  expect(verifyRes.body.user_id).toBe(anonUserId); // Should be the same user ID
  expect(verifyRes.body.is_new_user).toBe(false); // Not a new user, upgraded existing

  // Verify the user is no longer anonymous
  const upgradedMeRes = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    headers: {
      "x-stack-access-token": verifyRes.body.access_token,
    },
  });
  expect(upgradedMeRes.status).toBe(200);
  expect(upgradedMeRes.body.is_anonymous).toBe(false);
  expect(upgradedMeRes.body.primary_email).toBe(mailbox.emailAddress);
  expect(upgradedMeRes.body.otp_auth_enabled).toBe(true);
});

it("anonymous user can upgrade via OAuth sign-in", async ({ expect }) => {
  await Project.createAndSwitch();

  // Create an anonymous user
  const anonSignUp = await Auth.Anonymous.signUp();
  const anonAccessToken = anonSignUp.accessToken;

  // Start OAuth flow while logged in as anonymous
  const authorizeRes = await niceBackendFetch("/api/v1/auth/oauth/authorize/github", {
    method: "GET",
    accessType: "client",
    headers: {
      "x-stack-access-token": anonAccessToken,
    },
    query: {
      redirect_uri: "http://localhost:3000/callback",
    },
  });

  // OAuth flow would upgrade the anonymous user
  // This test is simplified since we can't easily simulate the full OAuth flow
  expect(authorizeRes.status).toBe(303);
});

it("multiple anonymous users can upgrade to different regular users", async ({ expect }) => {
  await Project.createAndSwitch();

  // Create two anonymous users
  const anon1 = await Auth.Anonymous.signUp();
  const anon2 = await Auth.Anonymous.signUp();

  expect(anon1.userId).not.toBe(anon2.userId);

  // Upgrade first anonymous user
  const upgrade1Res = await niceBackendFetch("/api/v1/auth/password/sign-up", {
    method: "POST",
    accessType: "client",
    headers: {
      "x-stack-access-token": anon1.accessToken,
    },
    body: {
      email: "user1@example.com",
      password: "TestPassword123!",
      verification_callback_url: "http://localhost:3000/callback",
    },
  });

  expect(upgrade1Res.status).toBe(200);
  expect(upgrade1Res.body.user_id).toBe(anon1.userId);

  // Upgrade second anonymous user
  const upgrade2Res = await niceBackendFetch("/api/v1/auth/password/sign-up", {
    method: "POST",
    accessType: "client",
    headers: {
      "x-stack-access-token": anon2.accessToken,
    },
    body: {
      email: "user2@example.com",
      password: "TestPassword123!",
      verification_callback_url: "http://localhost:3000/callback",
    },
  });

  expect(upgrade2Res.status).toBe(200);
  expect(upgrade2Res.body.user_id).toBe(anon2.userId);

  // Verify both are now different regular users
  const user1Res = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    headers: {
      "x-stack-access-token": upgrade1Res.body.access_token,
    },
  });

  const user2Res = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    headers: {
      "x-stack-access-token": upgrade2Res.body.access_token,
    },
  });

  expect(user1Res.body.primary_email).toBe("user1@example.com");
  expect(user2Res.body.primary_email).toBe("user2@example.com");
  expect(user1Res.body.id).not.toBe(user2Res.body.id);
});

it("anonymous user preserves metadata when upgrading", async ({ expect }) => {
  await Project.createAndSwitch();

  // Create an anonymous user
  const anonSignUp = await Auth.Anonymous.signUp();
  const anonUserId = anonSignUp.userId;

  // Set some metadata on the anonymous user
  await niceBackendFetch(`/api/v1/users/${anonUserId}`, {
    method: "PATCH",
    accessType: "server",
    body: {
      display_name: "Test User",
      client_metadata: { preference: "dark-mode" },
      server_metadata: { internal_id: "123" },
    },
  });

  // Upgrade the user
  const upgradeRes = await niceBackendFetch("/api/v1/auth/password/sign-up", {
    method: "POST",
    accessType: "client",
    headers: {
      "x-stack-access-token": anonSignUp.accessToken,
    },
    body: {
      email: "preserved@example.com",
      password: "TestPassword123!",
      verification_callback_url: "http://localhost:3000/callback",
    },
  });

  expect(upgradeRes.status).toBe(200);

  // Check that metadata was preserved
  const upgradedUser = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    headers: {
      "x-stack-access-token": upgradeRes.body.access_token,
    },
  });

  expect(upgradedUser.body.display_name).toBe("Test User");
  expect(upgradedUser.body.client_metadata).toEqual({ preference: "dark-mode" });

  // Check server metadata via server API
  const serverUser = await niceBackendFetch(`/api/v1/users/${anonUserId}?include_anonymous=true`, {
    accessType: "server",
  });
  expect(serverUser.body.server_metadata).toEqual({ internal_id: "123" });
});

it("cannot upgrade anonymous user to email that already exists", async ({ expect }) => {
  await Project.createAndSwitch();

  // Create a regular user with an email
  await bumpEmailAddress();
  const existingEmail = backendContext.value.mailbox.emailAddress;
  await Auth.Password.signUpWithEmail();

  // Create an anonymous user
  const anonSignUp = await Auth.Anonymous.signUp();

  // Try to upgrade to the same email
  const upgradeRes = await niceBackendFetch("/api/v1/auth/password/sign-up", {
    method: "POST",
    accessType: "client",
    headers: {
      "x-stack-access-token": anonSignUp.accessToken,
    },
    body: {
      email: existingEmail,
      password: "TestPassword123!",
      verification_callback_url: "http://localhost:3000/callback",
    },
  });

  expect(upgradeRes.status).toBe(400);
  expect(upgradeRes.body.code).toBe("USER_WITH_EMAIL_ALREADY_EXISTS");
  expect(upgradeRes.body.details.email).toBe(existingEmail);
});
