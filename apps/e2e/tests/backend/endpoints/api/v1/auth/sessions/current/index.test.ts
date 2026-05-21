import { it } from "../../../../../../../helpers";
import { Auth, backendContext, niceBackendFetch } from "../../../../../../backend-helpers";

it("should not crash when signing out a session that was already deleted by a bulk operation", async ({ expect }) => {
  // Reproduce: sign up, then admin-delete all refresh tokens (simulating a
  // concurrent password change), then attempt sign-out with the stale access token.
  // Before fix: 500 assertion error in recordExternalDbSyncDeletion.
  // After fix: 401 REFRESH_TOKEN_NOT_FOUND_OR_EXPIRED.
  const signUpRes = await Auth.Password.signUpWithEmail({ noWaitForEmail: true });
  const savedAuth = backendContext.value.userAuth ?? undefined;

  // Admin updates the user's password, which bulk-deletes all refresh tokens
  await niceBackendFetch(`/api/v1/users/${signUpRes.userId}`, {
    accessType: "admin",
    method: "PATCH",
    body: { password: "completely-new-password-12345" },
  });

  // Try to sign out using the original access token (which still references the
  // now-deleted refresh token). This should NOT throw a 500 assertion error.
  const response = await niceBackendFetch("/api/v1/auth/sessions/current", {
    method: "DELETE",
    accessType: "client",
    userAuth: savedAuth,
  });
  expect(response.status).not.toBe(500);
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "REFRESH_TOKEN_NOT_FOUND_OR_EXPIRED",
        "error": "Refresh token not found for this project, or the session has expired/been revoked.",
      },
      "headers": Headers {
        "x-stack-known-error": "REFRESH_TOKEN_NOT_FOUND_OR_EXPIRED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should not crash when deleting a session that was already deleted by a bulk operation", async ({ expect }) => {
  // Same race condition but via the sessions CRUD DELETE endpoint
  const signUpRes = await Auth.Password.signUpWithEmail({ noWaitForEmail: true });

  // Create a second session
  const newSessionRes = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "server",
    method: "POST",
    body: { user_id: signUpRes.userId },
  });
  expect(newSessionRes.status).toBe(200);

  // List sessions to get the second session's ID
  const listRes = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "client",
    method: "GET",
    query: { user_id: signUpRes.userId },
  });
  expect(listRes.status).toBe(200);
  const nonCurrentSession = listRes.body.items.find((s: any) => !s.is_current_session);
  expect(nonCurrentSession).toBeDefined();

  // Admin-update user password → bulk-deletes all refresh tokens
  await niceBackendFetch(`/api/v1/users/${signUpRes.userId}`, {
    accessType: "admin",
    method: "PATCH",
    body: { password: "another-new-password-12345" },
  });

  // Try to delete the (now-deleted) session via CRUD endpoint
  const deleteRes = await niceBackendFetch(`/api/v1/auth/sessions/${nonCurrentSession.id}`, {
    accessType: "client",
    method: "DELETE",
    query: { user_id: signUpRes.userId },
  });
  expect(deleteRes.status).not.toBe(500);
  expect(deleteRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": "Session not found.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should sign out users", async ({ expect }) => {
  await Auth.Password.signUpWithEmail();
  await Auth.expectToBeSignedIn();
  const res = await Auth.signOut();
  expect(res.signOutResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  await Auth.expectToBeSignedOut();
  const refreshSessionResponse = await niceBackendFetch("/api/v1/auth/sessions/current/refresh", {
    method: "POST",
    accessType: "client",
  });
  expect(refreshSessionResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "REFRESH_TOKEN_NOT_FOUND_OR_EXPIRED",
        "error": "Refresh token not found for this project, or the session has expired/been revoked.",
      },
      "headers": Headers {
        "x-stack-known-error": "REFRESH_TOKEN_NOT_FOUND_OR_EXPIRED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should sign out user without refresh token, only using access token", async ({ expect }) => {
  await Auth.Password.signUpWithEmail();
  const response = await niceBackendFetch("/api/v1/auth/sessions/current", {
    method: "DELETE",
    accessType: "client",
    // missing refresh token
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it.todo("should not sign out users of a different project");

// TODO currently not supported, the endpoint just throws an error when only access token is given
it.todo("should sign out users even without refresh token");
