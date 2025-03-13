import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { it } from "../../../../../../helpers";
import { Auth, backendContext, createMailbox, niceBackendFetch } from "../../../../../backend-helpers";

it("cannot create sessions from the client", async ({ expect }) => {
  const res = await Auth.Password.signUpWithEmail();
  const res2 = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "client",
    method: "POST",
    body: {
      user_id: res.userId,
      expires_in_millis: 1000 * 60 * 60 * 24 * 366,
    },
  });
  expect(res2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "INSUFFICIENT_ACCESS_TYPE",
        "details": {
          "actual_access_type": "client",
          "allowed_access_types": [
            "server",
            "admin",
          ],
        },
        "error": "The x-stack-access-type header must be 'server' or 'admin', but was 'client'.",
      },
      "headers": Headers {
        "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("creates sessions for existing users", async ({ expect }) => {
  const res = await Auth.Password.signUpWithEmail();
  backendContext.set({ userAuth: null });
  await Auth.expectToBeSignedOut();
  const res2 = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "server",
    method: "POST",
    body: {
      user_id: res.userId,
    },
  });
  expect(res2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "access_token": <stripped field 'access_token'>,
        "refresh_token": <stripped field 'refresh_token'>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("creates sessions that expire", async ({ expect }) => {
  const res = await Auth.Password.signUpWithEmail();
  await Auth.expectToBeSignedIn();
  const beginDate = new Date();
  const res2 = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "server",
    method: "POST",
    body: {
      user_id: res.userId,
      expires_in_millis: 5_000,
    },
  });
  expect(res2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "access_token": <stripped field 'access_token'>,
        "refresh_token": <stripped field 'refresh_token'>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  const waitPromise = wait(5_001);
  try {
    const refreshSessionResponse1 = await niceBackendFetch("/api/v1/auth/sessions/current/refresh", {
      method: "POST",
      accessType: "client",
      headers: {
        "x-stack-refresh-token": res2.body.refresh_token
      },
    });
    expect(refreshSessionResponse1).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "access_token": <stripped field 'access_token'> },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
    backendContext.set({ userAuth: { accessToken: refreshSessionResponse1.body.access_token, refreshToken: res2.body.refresh_token } });
    await Auth.expectToBeSignedIn();
  } finally {
    const timeSinceBeginDate = new Date().getTime() - beginDate.getTime();
    if (timeSinceBeginDate > 4_000) {
      throw new StackAssertionError(`Timeout error: Requests were too slow (${timeSinceBeginDate}ms > 4000ms); try again or try to understand why they were slow.`);
    }
  }
  await waitPromise;
  const refreshSessionResponse2 = await niceBackendFetch("/api/v1/auth/sessions/current/refresh", {
    method: "POST",
    accessType: "client",
    headers: {
      "x-stack-refresh-token": res2.body.refresh_token
    },
  });
  expect(refreshSessionResponse2).toMatchInlineSnapshot(`
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
  backendContext.set({ userAuth: { accessToken: undefined, refreshToken: res2.body.refresh_token } });
  await Auth.expectToBeSignedOut();
}, {
  // we wanna retry this, because in development mode, often the first time is slow due to compilation
  retry: 1,
});

it("cannot create sessions with an expiry date larger than a year away", async ({ expect }) => {
  const res = await Auth.Password.signUpWithEmail();
  const res2 = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "server",
    method: "POST",
    body: {
      user_id: res.userId,
      expires_in_millis: 1000 * 60 * 60 * 24 * 370,
    },
  });
  expect(res2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/auth/sessions:
              - body.expires_in_millis must be less than or equal to 31708800000
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/auth/sessions:
            - body.expires_in_millis must be less than or equal to 31708800000
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("can delete sessions as client", async ({ expect }) => {
  // Create a user and sign up
  const res = await Auth.Password.signUpWithEmail();
  const additionalSession = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "server",
    method: "POST",
    body: {
      user_id: res.userId,
    },
  });


  // List all sessions
  const listResponse = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "client",
    method: "GET",
    query: {
      user_id: res.userId,
    },
  });
  expect(listResponse.status).toBe(200);
  expect(listResponse.body.items.length).toBe(2);

  // Find and delete the non-current session
  const nonCurrentSession = listResponse.body.items.find((session: any) => !session.is_current_session);
  expect(nonCurrentSession).toBeDefined();

  const deleteResponse = await niceBackendFetch(`/api/v1/auth/sessions/${nonCurrentSession.id}`, {
    accessType: "client",
    method: "DELETE",
    query: {
      user_id: res.userId,
    },
  });
  expect(deleteResponse.status).toBe(200);

  // Verify the session was deleted by listing sessions again
  const finalListResponse = await niceBackendFetch(`/api/v1/auth/sessions`, {
    accessType: "client",
    method: "GET",
    query: {
      user_id: res.userId,
    },
  });
  expect(finalListResponse.status).toBe(200);
  expect(finalListResponse.body.items.length).toBe(1);
  expect(finalListResponse.body.items[0].is_current_session).toBe(true);
});

it("cannot delete current session as client", async ({ expect }) => {
  // Create a user and sign up
  const res = await Auth.Password.signUpWithEmail();

  // List sessions to get the current session ID
  const listResponse = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "client",
    method: "GET",
    query: {
      user_id: res.userId,
    },
  });
  expect(listResponse.status).toBe(200);

  // Find the current session
  const currentSession = listResponse.body.items.find((session: any) => session.is_current_session);
  expect(currentSession).toBeDefined();

  // Attempt to delete the current session
  const deleteResponse = await niceBackendFetch(`/api/v1/auth/sessions/${currentSession.id}`, {
    accessType: "client",
    query: {
      user_id: res.userId,
    },
    method: "DELETE",
  });
  expect(deleteResponse.status).toBe(400);
  expect(deleteResponse.body).toMatchInlineSnapshot(`
    {
      "code": "CANNOT_DELETE_CURRENT_SESSION",
      "error": "Cannot delete the current session.",
    }
  `);

  // Verify the session was not deleted by listing sessions again
  const finalListResponse = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "client",
    method: "GET",
    query: {
      user_id: res.userId,
    },
  });
  expect(finalListResponse.status).toBe(200);
  expect(finalListResponse.body.items.length).toBe(1);
  expect(finalListResponse.body.items[0].is_current_session).toBe(true);
});

it("cannot read another user's sessions as client", async ({ expect }) => {
  // Create first user and sign up
  const user1 = await Auth.Password.signUpWithEmail();

  // Create second user and sign up
  backendContext.set({ userAuth: null, mailbox: createMailbox() }); // Clear first user's auth
  const user2 = await Auth.Password.signUpWithEmail();

  // Try to read user1's sessions while authenticated as user2
  const listResponse = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "client",
    method: "GET",
    query: {
      user_id: user1.userId,
    },
  });

  // Should get a 401 unauthorized response
  expect(listResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": "Client can only list sessions for their own user.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("server cannot list sessions without user_id", async ({ expect }) => {
  // Attempt to list sessions without providing user_id
  const listResponse = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "server",
    method: "GET",
  });

  // Should get a 400 bad request response
  expect(listResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on GET /api/v1/auth/sessions:
              - query.user_id must be defined
          \`,
        },
        "error": deindent\`
          Request validation failed on GET /api/v1/auth/sessions:
            - query.user_id must be defined
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("impersonation sessions hidden for non-admin clients and shown for admins", async ({ expect }) => {
  // Create a user and sign up
  const res = await Auth.Password.signUpWithEmail();

  // Create an impersonation session for the user
  const impersonationSession = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "server",
    method: "POST",
    body: {
      user_id: res.userId,
      is_impersonation: true,
    },
  });
  expect(impersonationSession.status).toBe(200);

  // Create a regular session for the user
  const regularSession = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "server",
    method: "POST",
    body: {
      user_id: res.userId,
      is_impersonation: false,
    },
  });
  expect(regularSession.status).toBe(200);

  // List all sessions as client
  const listResponse = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "client",
    method: "GET",
    query: {
      user_id: res.userId,
    },
  });
  expect(listResponse.status).toBe(200);

  // Verify that only the regular session and the current session are in the list
  // The impersonation session should not be included
  const sessions = listResponse.body.items;
  expect(sessions.length).toBe(2); // Current session + regular session

  // Verify none of the sessions are marked as impersonation
  expect(sessions.every((session: any) => session.is_impersonation === false)).toBe(true);

  // List all sessions as admin (should include impersonation sessions)
  const adminListResponse = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "admin",
    method: "GET",
    query: {
      user_id: res.userId,
    },
  });
  expect(adminListResponse.status).toBe(200);

  // Verify that all sessions are in the list for admin
  const adminSessions = adminListResponse.body.items;
  expect(adminSessions.length).toBe(3); // Current session + regular session + impersonation session

  // Verify at least one session is marked as impersonation
  const impersonationSessions = adminSessions.filter((session: any) => session.is_impersonation);
  expect(impersonationSessions.length).toBeGreaterThan(0);
});

