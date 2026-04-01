import { it } from "../../../../../../helpers";
import { Auth, Team, niceBackendFetch } from "../../../../../backend-helpers";

it("should set the refresh token for a CLI auth attempt and return success when polling", async ({ expect }) => {
  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "server",
    body: {},
  });

  const authenticatedBrowserUser = await Auth.fastSignUp();

  const sessionStateResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: createResponse.body.login_code,
      mode: "check",
    },
  });
  expect(sessionStateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "cli_session_state": "none" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const loginResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: createResponse.body.login_code,
      mode: "complete",
      refresh_token: authenticatedBrowserUser.refreshToken,
    },
  });
  expect(loginResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const pollResponse = await niceBackendFetch("/api/latest/auth/cli/poll", {
    method: "POST",
    accessType: "server",
    body: { polling_code: createResponse.body.polling_code },
  });

  expect(pollResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "refresh_token": <stripped field 'refresh_token'>,
        "status": "success",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  expect(pollResponse.body.refresh_token).toBe(authenticatedBrowserUser.refreshToken);

  const pollResponse2 = await niceBackendFetch("/api/latest/auth/cli/poll", {
    method: "POST",
    accessType: "server",
    body: { polling_code: createResponse.body.polling_code },
  });

  expect(pollResponse2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "status": "used" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should return anonymous CLI session details when the CLI started from an anonymous user", async ({ expect }) => {
  const cliAnonymousUser = await Auth.Anonymous.signUp();
  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "server",
    body: {
      anon_refresh_token: cliAnonymousUser.refreshToken,
    },
  });

  const sessionStateResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: createResponse.body.login_code,
      mode: "check",
    },
  });
  expect(sessionStateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "cli_session_state": "anonymous" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const claimResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: createResponse.body.login_code,
      mode: "claim-anon-session",
    },
  });
  expect(claimResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "access_token": <stripped field 'access_token'>,
        "refresh_token": <stripped field 'refresh_token'>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  expect(claimResponse.body.refresh_token).toBe(cliAnonymousUser.refreshToken);
});

it("should merge the CLI anonymous user into the authenticated browser user before completing", async ({ expect }) => {
  const cliAnonymousUser = await Auth.Anonymous.signUp();
  const { teamId } = await Team.create();
  await Team.addMember(teamId, cliAnonymousUser.userId);

  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "server",
    body: {
      anon_refresh_token: cliAnonymousUser.refreshToken,
    },
  });

  const authenticatedBrowserUser = await Auth.fastSignUp();
  const completeResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: createResponse.body.login_code,
      mode: "complete",
      refresh_token: authenticatedBrowserUser.refreshToken,
    },
  });
  expect(completeResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const pollResponse = await niceBackendFetch("/api/latest/auth/cli/poll", {
    method: "POST",
    accessType: "server",
    body: { polling_code: createResponse.body.polling_code },
  });
  expect(pollResponse.status).toBe(201);
  expect(pollResponse.body.refresh_token).toBe(authenticatedBrowserUser.refreshToken);

  const teamUsersResponse = await niceBackendFetch(`/api/v1/users?team_id=${teamId}&include_anonymous=true`, {
    method: "GET",
    accessType: "server",
  });
  const teamUserIds = teamUsersResponse.body.items.map((user: { id: string }) => user.id);
  expect(teamUserIds).toContain(authenticatedBrowserUser.userId);
  expect(teamUserIds).not.toContain(cliAnonymousUser.userId);

  const deletedAnonymousUserResponse = await niceBackendFetch(`/api/v1/users/${cliAnonymousUser.userId}?include_anonymous=true`, {
    method: "GET",
    accessType: "server",
  });
  expect(deletedAnonymousUserResponse.status).toBe(404);
});

it("should keep the same user when the browser upgrades the CLI anonymous session in place", async ({ expect }) => {
  const cliAnonymousUser = await Auth.Anonymous.signUp();
  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "server",
    body: {
      anon_refresh_token: cliAnonymousUser.refreshToken,
    },
  });

  const browserUpgradeResponse = await Auth.Password.signUpWithEmail({ noWaitForEmail: true });
  expect(browserUpgradeResponse.userId).toBe(cliAnonymousUser.userId);

  const completeResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: createResponse.body.login_code,
      mode: "complete",
      refresh_token: browserUpgradeResponse.signUpResponse.body.refresh_token,
    },
  });
  expect(completeResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const pollResponse = await niceBackendFetch("/api/latest/auth/cli/poll", {
    method: "POST",
    accessType: "server",
    body: { polling_code: createResponse.body.polling_code },
  });
  expect(pollResponse.status).toBe(201);
  expect(pollResponse.body.refresh_token).toBe(browserUpgradeResponse.signUpResponse.body.refresh_token);
});

it("should return an error when trying to set the refresh token with an invalid login code", async ({ expect }) => {
  const loginResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: "invalid-login-code",
      mode: "complete",
      refresh_token: "test-refresh-token",
    },
  });

  expect(loginResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Invalid login code or the code has expired",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should not allow setting the refresh token twice", async ({ expect }) => {
  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "server",
    body: {},
  });

  const loginCode = createResponse.body.login_code;
  const authenticatedBrowserUser = await Auth.fastSignUp();
  const anotherAuthenticatedBrowserUser = await Auth.fastSignUp();

  const loginResponse1 = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: loginCode,
      mode: "complete",
      refresh_token: authenticatedBrowserUser.refreshToken,
    },
  });

  expect(loginResponse1).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const loginResponse2 = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: loginCode,
      mode: "complete",
      refresh_token: anotherAuthenticatedBrowserUser.refreshToken,
    },
  });

  expect(loginResponse2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Invalid login code or the code has expired",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should return an error when claiming anon session but no anon session exists", async ({ expect }) => {
  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "server",
    body: {},
  });

  const claimResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: createResponse.body.login_code,
      mode: "claim-anon-session",
    },
  });

  expect(claimResponse.status).toBe(400);
  expect(claimResponse.body).toContain("No anonymous session associated with this code");
});

it("should return an error when completing without a refresh_token", async ({ expect }) => {
  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "server",
    body: {},
  });

  const completeResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: createResponse.body.login_code,
      mode: "complete",
    },
  });

  expect(completeResponse.status).toBe(400);
  expect(completeResponse.body).toContain("refresh_token is required");
});

it("should return an error when completing with an invalid refresh_token", async ({ expect }) => {
  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "server",
    body: {},
  });

  const completeResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: createResponse.body.login_code,
      mode: "complete",
      refresh_token: "invalid-refresh-token-that-does-not-exist",
    },
  });

  expect(completeResponse.status).toBe(400);
  expect(completeResponse.body).toContain("Invalid refresh token");
});

it("should reject check/claim/complete on an expired code", async ({ expect }) => {
  const cliAnonymousUser = await Auth.Anonymous.signUp();
  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "server",
    body: {
      expires_in_millis: 1000,
      anon_refresh_token: cliAnonymousUser.refreshToken,
    },
  });
  expect(createResponse.status).toBe(200);

  await new Promise(resolve => setTimeout(resolve, 1500));

  const checkResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: createResponse.body.login_code,
      mode: "check",
    },
  });
  expect(checkResponse.status).toBe(400);

  const claimResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: createResponse.body.login_code,
      mode: "claim-anon-session",
    },
  });
  expect(claimResponse.status).toBe(400);

  const authenticatedUser = await Auth.fastSignUp();
  const completeResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: createResponse.body.login_code,
      mode: "complete",
      refresh_token: authenticatedUser.refreshToken,
    },
  });
  expect(completeResponse.status).toBe(400);
});

it("should transfer team membership and permissions from CLI anonymous user during merge", async ({ expect }) => {
  const cliAnonymousUser = await Auth.Anonymous.signUp();
  const { teamId } = await Team.create();
  await Team.addMember(teamId, cliAnonymousUser.userId);
  await Team.addPermission(teamId, cliAnonymousUser.userId, "$read_members");

  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "server",
    body: {
      anon_refresh_token: cliAnonymousUser.refreshToken,
    },
  });

  const authenticatedUser = await Auth.fastSignUp();
  const completeResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: createResponse.body.login_code,
      mode: "complete",
      refresh_token: authenticatedUser.refreshToken,
    },
  });
  expect(completeResponse.status).toBe(200);

  const teamUsersResponse = await niceBackendFetch(`/api/v1/users?team_id=${teamId}&include_anonymous=true`, {
    method: "GET",
    accessType: "server",
  });
  const teamUserIds = teamUsersResponse.body.items.map((u: { id: string }) => u.id);
  expect(teamUserIds).toContain(authenticatedUser.userId);
  expect(teamUserIds).not.toContain(cliAnonymousUser.userId);

  const deletedAnonResponse = await niceBackendFetch(`/api/v1/users/${cliAnonymousUser.userId}?include_anonymous=true`, {
    method: "GET",
    accessType: "server",
  });
  expect(deletedAnonResponse.status).toBe(404);
});

it("should preserve metadata from CLI anonymous user during merge when authenticated user has none", async ({ expect }) => {
  const cliAnonymousUser = await Auth.Anonymous.signUp();
  await niceBackendFetch(`/api/v1/users/${cliAnonymousUser.userId}`, {
    method: "PATCH",
    accessType: "server",
    body: {
      client_metadata: { cli_preference: "dark_mode" },
      server_metadata: { cli_data: "some_value" },
    },
  });

  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "server",
    body: {
      anon_refresh_token: cliAnonymousUser.refreshToken,
    },
  });

  const authenticatedUser = await Auth.fastSignUp();

  const completeResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: createResponse.body.login_code,
      mode: "complete",
      refresh_token: authenticatedUser.refreshToken,
    },
  });
  expect(completeResponse.status).toBe(200);

  const userResponse = await niceBackendFetch(`/api/v1/users/${authenticatedUser.userId}`, {
    method: "GET",
    accessType: "server",
  });
  expect(userResponse.status).toBe(200);
  expect(userResponse.body.client_metadata).toEqual({ cli_preference: "dark_mode" });
  expect(userResponse.body.server_metadata).toEqual({ cli_data: "some_value" });
});

it("should not overwrite authenticated user metadata with anonymous user metadata during merge", async ({ expect }) => {
  const cliAnonymousUser = await Auth.Anonymous.signUp();
  await niceBackendFetch(`/api/v1/users/${cliAnonymousUser.userId}`, {
    method: "PATCH",
    accessType: "server",
    body: {
      client_metadata: { from_anon: true },
      server_metadata: { anon_data: "old" },
    },
  });

  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "server",
    body: {
      anon_refresh_token: cliAnonymousUser.refreshToken,
    },
  });

  const authenticatedUser = await Auth.fastSignUp();
  await niceBackendFetch(`/api/v1/users/${authenticatedUser.userId}`, {
    method: "PATCH",
    accessType: "server",
    body: {
      client_metadata: { from_auth: true },
      server_metadata: { auth_data: "new" },
    },
  });

  const completeResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: createResponse.body.login_code,
      mode: "complete",
      refresh_token: authenticatedUser.refreshToken,
    },
  });
  expect(completeResponse.status).toBe(200);

  const userResponse = await niceBackendFetch(`/api/v1/users/${authenticatedUser.userId}`, {
    method: "GET",
    accessType: "server",
  });
  expect(userResponse.status).toBe(200);
  expect(userResponse.body.client_metadata).toEqual({ from_auth: true });
  expect(userResponse.body.server_metadata).toEqual({ auth_data: "new" });
});

it("should handle merge when both users are members of the same team", async ({ expect }) => {
  const cliAnonymousUser = await Auth.Anonymous.signUp();
  const { teamId } = await Team.create();
  await Team.addMember(teamId, cliAnonymousUser.userId);

  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "server",
    body: {
      anon_refresh_token: cliAnonymousUser.refreshToken,
    },
  });

  const authenticatedUser = await Auth.fastSignUp();
  await Team.addMember(teamId, authenticatedUser.userId);

  const completeResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: createResponse.body.login_code,
      mode: "complete",
      refresh_token: authenticatedUser.refreshToken,
    },
  });
  expect(completeResponse.status).toBe(200);

  const teamUsersResponse = await niceBackendFetch(`/api/v1/users?team_id=${teamId}&include_anonymous=true`, {
    method: "GET",
    accessType: "server",
  });
  const teamUserIds = teamUsersResponse.body.items.map((u: { id: string }) => u.id);
  expect(teamUserIds).toContain(authenticatedUser.userId);
  expect(teamUserIds).not.toContain(cliAnonymousUser.userId);
});

it("should skip merge when CLI has no anon session and complete directly", async ({ expect }) => {
  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "server",
    body: {},
  });

  const authenticatedUser = await Auth.fastSignUp();

  const completeResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: createResponse.body.login_code,
      mode: "complete",
      refresh_token: authenticatedUser.refreshToken,
    },
  });
  expect(completeResponse.status).toBe(200);
  expect(completeResponse.body.success).toBe(true);

  const pollResponse = await niceBackendFetch("/api/latest/auth/cli/poll", {
    method: "POST",
    accessType: "server",
    body: { polling_code: createResponse.body.polling_code },
  });
  expect(pollResponse.status).toBe(201);
  expect(pollResponse.body.refresh_token).toBe(authenticatedUser.refreshToken);
});

it("should complete with client access type", async ({ expect }) => {
  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "client",
    body: {},
  });

  const authenticatedUser = await Auth.fastSignUp();

  const completeResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "client",
    body: {
      login_code: createResponse.body.login_code,
      mode: "complete",
      refresh_token: authenticatedUser.refreshToken,
    },
  });
  expect(completeResponse.status).toBe(200);
  expect(completeResponse.body.success).toBe(true);
});

it("should handle the full claim → upgrade → complete flow with same user ID", async ({ expect }) => {
  const cliAnonymousUser = await Auth.Anonymous.signUp();
  const originalUserId = cliAnonymousUser.userId;

  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "server",
    body: {
      anon_refresh_token: cliAnonymousUser.refreshToken,
    },
  });

  const checkResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: createResponse.body.login_code,
      mode: "check",
    },
  });
  expect(checkResponse.body.cli_session_state).toBe("anonymous");

  const claimResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: createResponse.body.login_code,
      mode: "claim-anon-session",
    },
  });
  expect(claimResponse.status).toBe(200);
  expect(claimResponse.body.refresh_token).toBe(cliAnonymousUser.refreshToken);

  const upgradeResponse = await Auth.Password.signUpWithEmail({ noWaitForEmail: true });

  expect(upgradeResponse.userId).toBe(originalUserId);

  const completeResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: createResponse.body.login_code,
      mode: "complete",
      refresh_token: upgradeResponse.signUpResponse.body.refresh_token,
    },
  });
  expect(completeResponse.status).toBe(200);
  expect(completeResponse.body.success).toBe(true);

  const pollResponse = await niceBackendFetch("/api/latest/auth/cli/poll", {
    method: "POST",
    accessType: "server",
    body: { polling_code: createResponse.body.polling_code },
  });
  expect(pollResponse.status).toBe(201);
  expect(pollResponse.body.refresh_token).toBe(upgradeResponse.signUpResponse.body.refresh_token);

  const userResponse = await niceBackendFetch(`/api/v1/users/${originalUserId}`, {
    method: "GET",
    accessType: "server",
  });
  expect(userResponse.status).toBe(200);
  expect(userResponse.body.is_anonymous).toBe(false);
});
