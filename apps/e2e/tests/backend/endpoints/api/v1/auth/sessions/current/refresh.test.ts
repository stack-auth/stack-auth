import { it } from "../../../../../../../helpers";
import { Auth, backendContext, niceBackendFetch } from "../../../../../../backend-helpers";

it("should refresh sessions", async ({ expect }) => {
  await Auth.Password.signUpWithEmail();
  backendContext.set({ userAuth: { ...backendContext.value.userAuth, accessToken: undefined } });
  await Auth.expectSessionToBeValid();
  const refreshSessionResponse = await niceBackendFetch("/api/v1/auth/sessions/current/refresh", {
    method: "POST",
    accessType: "client",
  });
  expect(refreshSessionResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "access_token": <stripped field 'access_token'> },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  backendContext.set({ userAuth: { ...backendContext.value.userAuth, accessToken: refreshSessionResponse.body.access_token } });
  await Auth.expectSessionToBeValid();
  await Auth.expectToBeSignedIn();
});

it("should not refresh sessions given invalid refresh tokens", async ({ expect }) => {
  await Auth.Password.signUpWithEmail();
  const refreshSessionResponse = await niceBackendFetch("/api/v1/auth/sessions/current/refresh", {
    method: "POST",
    accessType: "client",
    headers: {
      "x-stack-refresh-token": "something-invalid"
    },
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

it.todo("should not refresh sessions of other projects");

it("should not refresh revoked sessions", async ({ expect }) => {
  // Create a user and sign up
  const res = await Auth.Password.signUpWithEmail();

  // Create an additional session for the user
  const additionalSession = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "server",
    method: "POST",
    body: {
      user_id: res.userId,
    },
  });

  // Verify the additional session can be refreshed
  const refreshBeforeRevokeResponse = await niceBackendFetch("/api/v1/auth/sessions/current/refresh", {
    method: "POST",
    accessType: "client",
    headers: {
      "x-stack-refresh-token": additionalSession.body.refresh_token
    },
  });
  expect(refreshBeforeRevokeResponse.status).toBe(200);
  expect(refreshBeforeRevokeResponse.body.access_token).toBeDefined();

  // List all sessions to find the session ID
  const listResponse = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "client",
    method: "GET",
    query: {
      user_id: res.userId,
    },
  });
  expect(listResponse.status).toBe(200);

  // Find the non-current session (the additional one we created)
  const nonCurrentSession = listResponse.body.items.find((session: any) => !session.is_current_session);
  expect(nonCurrentSession).toBeDefined();

  // Revoke (delete) the additional session
  const deleteResponse = await niceBackendFetch(`/api/v1/auth/sessions/${nonCurrentSession.id}`, {
    accessType: "client",
    method: "DELETE",
    query: {
      user_id: res.userId,
    },
  });
  expect(deleteResponse.status).toBe(200);

  // Attempt to refresh the revoked session
  const refreshAfterRevokeResponse = await niceBackendFetch("/api/v1/auth/sessions/current/refresh", {
    method: "POST",
    accessType: "client",
    headers: {
      "x-stack-refresh-token": additionalSession.body.refresh_token
    },
  });

  // Verify that the revoked session cannot be refreshed
  expect(refreshAfterRevokeResponse.status).toBe(401);
  expect(refreshAfterRevokeResponse.body).toMatchInlineSnapshot(`
    {
      "code": "REFRESH_TOKEN_NOT_FOUND_OR_EXPIRED",
      "error": "Refresh token not found for this project, or the session has expired/been revoked.",
    }
  `);

  // Verify that the original session can still be refreshed
  const originalRefreshResponse = await niceBackendFetch("/api/v1/auth/sessions/current/refresh", {
    method: "POST",
    accessType: "client",
  });

  // The original session should still be valid
  expect(originalRefreshResponse.status).toBe(200);
  expect(originalRefreshResponse.body.access_token).toBeDefined();

  // Update the access token for subsequent requests
  backendContext.set({ userAuth: { ...backendContext.value.userAuth, accessToken: originalRefreshResponse.body.access_token } });

  // Verify the session is still valid
  await Auth.expectSessionToBeValid();
  await Auth.expectToBeSignedIn();
});
