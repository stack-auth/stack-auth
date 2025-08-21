import { it } from "../../../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../../../backend-helpers";

it("anonymous users can sign up on any project now", async ({ expect }) => {
  await Project.createAndSwitch();
  const res = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
    accessType: "client",
    method: "POST",
  });
  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "access_token": expect.any(String),
        "refresh_token": expect.any(String),
        "user_id": expect.any(String),
      },
    }
  `);
});

it("anonymous JWT has different kid and role", async ({ expect }) => {
  await Project.createAndSwitch();
  const signUpRes = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
    accessType: "client",
    method: "POST",
  });

  const accessToken = signUpRes.body.access_token;

  // Decode the JWT to check the role
  const [header, payload] = accessToken.split('.').slice(0, 2).map((part: string) =>
    JSON.parse(Buffer.from(part, 'base64url').toString())
  );

  expect(payload.role).toBe('anon');
  expect(header.kid).toBeTruthy();

  // The kid should be different from regular users
  const regularSignUp = await Auth.Password.signUpWithEmail();
  const regularToken = regularSignUp.signUpResponse.body.access_token;
  const [regularHeader] = regularToken.split('.').slice(0, 1).map((part: string) =>
    JSON.parse(Buffer.from(part, 'base64url').toString())
  );

  expect(header.kid).not.toBe(regularHeader.kid);
});

it("JWKS endpoint includes anonymous key when requested", async ({ expect }) => {
  const project = await Project.createAndSwitch();

  // Regular JWKS request - should not include anonymous key
  const regularJwks = await niceBackendFetch(`/api/v1/projects/${project.projectId}/.well-known/jwks.json`, {
    method: "GET",
    accessType: null,
  });
  expect(regularJwks.status).toBe(200);
  const regularKeys = regularJwks.body.keys;
  expect(regularKeys).toHaveLength(1);

  // JWKS request with include_anonymous - should include both keys
  const anonymousJwks = await niceBackendFetch(`/api/v1/projects/${project.projectId}/.well-known/jwks.json?include_anonymous=true`, {
    method: "GET",
    accessType: null,
  });
  expect(anonymousJwks.status).toBe(200);
  const allKeys = anonymousJwks.body.keys;
  expect(allKeys).toHaveLength(2);

  // Check that the kids are different
  const kids = allKeys.map((key: any) => key.kid);
  expect(new Set(kids).size).toBe(2);
});

it("anonymous users are rejected without X-Stack-Allow-Anonymous-User header", async ({ expect }) => {
  await Project.createAndSwitch();
  const signUpRes = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
    accessType: "client",
    method: "POST",
  });

  const accessToken = signUpRes.body.access_token;

  // Try to access an endpoint without the header
  const res = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    headers: {
      "x-stack-access-token": accessToken,
      "x-stack-allow-anonymous-user": "false",
    },
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "ANONYMOUS_AUTHENTICATION_NOT_ALLOWED",
        "error": "Anonymous authentication is not allowed for this endpoint. Set X-Stack-Allow-Anonymous-User header to 'true' to allow anonymous users.",
      },
      "headers": Headers {
        "x-stack-known-error": "ANONYMOUS_AUTHENTICATION_NOT_ALLOWED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("anonymous users are accepted with X-Stack-Allow-Anonymous-User header", async ({ expect }) => {
  await Project.createAndSwitch();
  const signUpRes = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
    accessType: "client",
    method: "POST",
  });

  const accessToken = signUpRes.body.access_token;

  // Access with the header set to true
  const res = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    headers: {
      "x-stack-access-token": accessToken,
      "x-stack-allow-anonymous-user": "true",
    },
  });

  expect(res.status).toBe(200);
  expect(res.body.is_anonymous).toBe(true);
  expect(res.body.display_name).toBe("Anonymous user");
});

it("list users excludes anonymous users by default", async ({ expect }) => {
  await Project.createAndSwitch();

  // Create an anonymous user
  await Auth.Anonymous.signUp();

  // Create a regular user
  await Auth.Password.signUpWithEmail();

  // List users without include_anonymous
  const listRes = await niceBackendFetch("/api/v1/users", {
    accessType: "server",
  });

  expect(listRes.status).toBe(200);
  const users = listRes.body.items;

  // Should only include the regular user
  expect(users).toHaveLength(1);
  expect(users[0].is_anonymous).toBe(false);
});

it("list users includes anonymous users when requested", async ({ expect }) => {
  await Project.createAndSwitch();

  // Create an anonymous user
  await Auth.Anonymous.signUp();

  // Create a regular user
  await Auth.Password.signUpWithEmail();

  // List users with include_anonymous=true
  const listRes = await niceBackendFetch("/api/v1/users?include_anonymous=true", {
    accessType: "server",
  });

  expect(listRes.status).toBe(200);
  const users = listRes.body.items;

  // Should include both users
  expect(users).toHaveLength(2);
  const anonymousUsers = users.filter((u: any) => u.is_anonymous);
  const regularUsers = users.filter((u: any) => !u.is_anonymous);

  expect(anonymousUsers).toHaveLength(1);
  expect(regularUsers).toHaveLength(1);
});

it("get user by id excludes anonymous users by default", async ({ expect }) => {
  await Project.createAndSwitch();

  // Create an anonymous user
  const anonSignUp = await Auth.Anonymous.signUp();
  const anonUserId = anonSignUp.userId;

  // Try to get the anonymous user without include_anonymous
  const res = await niceBackendFetch(`/api/v1/users/${anonUserId}`, {
    accessType: "server",
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": {
        "code": "USER_NOT_FOUND",
        "details": {
          "user_id": "${anonUserId}",
        },
        "error": "User not found.",
      },
      "headers": Headers {
        "x-stack-known-error": "USER_NOT_FOUND",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("get user by id includes anonymous users when requested", async ({ expect }) => {
  await Project.createAndSwitch();

  // Create an anonymous user
  const anonSignUp = await Auth.Anonymous.signUp();
  const anonUserId = anonSignUp.userId;

  // Get the anonymous user with include_anonymous=true
  const res = await niceBackendFetch(`/api/v1/users/${anonUserId}?include_anonymous=true`, {
    accessType: "server",
  });

  expect(res.status).toBe(200);
  expect(res.body.id).toBe(anonUserId);
  expect(res.body.is_anonymous).toBe(true);
});

it("anonymous users cannot be added to teams", async ({ expect }) => {
  await Project.createAndSwitch();

  // Create an anonymous user
  const anonSignUp = await Auth.Anonymous.signUp();
  const anonUserId = anonSignUp.userId;

  // Create a team
  const teamRes = await niceBackendFetch("/api/v1/teams", {
    accessType: "server",
    method: "POST",
    body: {
      display_name: "Test Team",
    },
  });
  const teamId = teamRes.body.id;

  // Try to add the anonymous user to the team
  const res = await niceBackendFetch(`/api/v1/team-memberships/${teamId}/${anonUserId}`, {
    accessType: "server",
    method: "POST",
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANONYMOUS_USERS_CANNOT_BE_TEAM_MEMBERS",
        "error": "Anonymous users cannot be added to teams.",
      },
      "headers": Headers {
        "x-stack-known-error": "ANONYMOUS_USERS_CANNOT_BE_TEAM_MEMBERS",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("anonymous users can upgrade to regular users", async ({ expect }) => {
  await Project.createAndSwitch();

  // Create an anonymous user
  const anonSignUp = await Auth.Anonymous.signUp();
  const anonUserId = anonSignUp.userId;
  const anonAccessToken = anonSignUp.accessToken;

  // Upgrade the anonymous user by adding an email
  const upgradeRes = await niceBackendFetch(`/api/v1/users/${anonUserId}`, {
    accessType: "server",
    method: "PATCH",
    body: {
      primary_email: "upgraded@example.com",
      primary_email_verified: true,
      is_anonymous: false,
    },
  });

  expect(upgradeRes.status).toBe(200);
  expect(upgradeRes.body.is_anonymous).toBe(false);
  expect(upgradeRes.body.primary_email).toBe("upgraded@example.com");

  // The old anonymous token should still work with the header
  const meRes = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    headers: {
      "x-stack-access-token": anonAccessToken,
      "x-stack-allow-anonymous-user": "true",
    },
  });

  expect(meRes.status).toBe(200);
  expect(meRes.body.is_anonymous).toBe(false);
});

it("team list members excludes anonymous users", async ({ expect }) => {
  await Project.createAndSwitch();

  // Create a team
  const teamRes = await niceBackendFetch("/api/v1/teams", {
    accessType: "server",
    method: "POST",
    body: {
      display_name: "Test Team",
    },
  });
  const teamId = teamRes.body.id;

  // Create an anonymous user (shouldn't be in any team)
  await Auth.Anonymous.signUp();

  // Create a regular user and add to team
  const regularSignUp = await Auth.Password.signUpWithEmail();
  await niceBackendFetch(`/api/v1/team-memberships/${teamId}/${regularSignUp.userId}`, {
    accessType: "server",
    method: "POST",
  });

  // List team members (by listing users filtered by team)
  const listRes = await niceBackendFetch(`/api/v1/users?team_id=${teamId}`, {
    accessType: "server",
  });

  expect(listRes.status).toBe(200);
  expect(listRes.body.items).toHaveLength(1);
  expect(listRes.body.items[0].is_anonymous).toBe(false);
});

it("search users excludes anonymous users by default", async ({ expect }) => {
  await Project.createAndSwitch();

  // Create an anonymous user with a specific display name
  const anonSignUp = await Auth.Anonymous.signUp();

  // Update anonymous user's display name
  await niceBackendFetch(`/api/v1/users/${anonSignUp.userId}`, {
    accessType: "server",
    method: "PATCH",
    body: {
      display_name: "Unique Anonymous Name",
    },
  });

  // Create a regular user
  await Auth.Password.signUpWithEmail();

  // Search for users with query matching anonymous user
  const searchRes = await niceBackendFetch("/api/v1/users?query=Unique", {
    accessType: "server",
  });

  expect(searchRes.status).toBe(200);
  expect(searchRes.body.items).toHaveLength(0);

  // Search with include_anonymous=true
  const searchWithAnonRes = await niceBackendFetch("/api/v1/users?query=Unique&include_anonymous=true", {
    accessType: "server",
  });

  expect(searchWithAnonRes.status).toBe(200);
  expect(searchWithAnonRes.body.items).toHaveLength(1);
  expect(searchWithAnonRes.body.items[0].display_name).toBe("Unique Anonymous Name");
  expect(searchWithAnonRes.body.items[0].is_anonymous).toBe(true);
});
