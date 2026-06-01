import { it } from "../../../../../../helpers";
import { Auth, niceBackendFetch } from "../../../../../backend-helpers";

async function createScopedSession(userId: string, scope: string | undefined) {
  const res = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "server",
    method: "POST",
    body: {
      user_id: userId,
      ...scope !== undefined ? { scope } : {},
    },
  });
  return res;
}

it("mints a scoped access token and enforces it on annotated endpoints", async ({ expect }) => {
  const { userId } = await Auth.Password.signUpWithEmail();

  // Server mints a session restricted to `teams:read` only.
  const sessionRes = await createScopedSession(userId, "teams:read");
  expect(sessionRes.status).toBe(200);
  const accessToken = sessionRes.body.access_token;

  // The token holds `teams:read`, so listing teams (requiredScopes: ["teams:read"]) succeeds.
  const listRes = await niceBackendFetch("/api/v1/teams", {
    accessType: "client",
    method: "GET",
    query: { user_id: "me" },
    userAuth: { accessToken },
  });
  expect(listRes.status).toBe(200);

  // The token does NOT hold `teams:write`, so creating a team (requiredScopes: ["teams:write"])
  // is rejected centrally with INSUFFICIENT_SCOPE before the handler ever runs.
  const createRes = await niceBackendFetch("/api/v1/teams", {
    accessType: "client",
    method: "POST",
    body: { display_name: "Scoped Test Team" },
    userAuth: { accessToken },
  });
  expect(createRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": {
        "code": "INSUFFICIENT_SCOPE",
        "details": { "missing_scopes": ["teams:write"] },
        "error": "The access token is missing the following required scope(s): 'teams:write'. Mint a token that includes these scopes and try again.",
      },
      "headers": Headers {
        "x-stack-known-error": "INSUFFICIENT_SCOPE",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("treats unrestricted (no-scope) sessions as unrestricted for scoped endpoints", async ({ expect }) => {
  const { userId } = await Auth.Password.signUpWithEmail();

  // A session minted without any scope is unrestricted (fail-open / backwards-compatible).
  const sessionRes = await createScopedSession(userId, undefined);
  expect(sessionRes.status).toBe(200);
  const accessToken = sessionRes.body.access_token;

  // Reading is allowed.
  const listRes = await niceBackendFetch("/api/v1/teams", {
    accessType: "client",
    method: "GET",
    query: { user_id: "me" },
    userAuth: { accessToken },
  });
  expect(listRes.status).toBe(200);

  // Writing is NOT blocked by scope enforcement (the unrestricted token carries no scope claim),
  // so the create request reaches the handler and is not an INSUFFICIENT_SCOPE error.
  const createRes = await niceBackendFetch("/api/v1/teams", {
    accessType: "client",
    method: "POST",
    body: { display_name: "Unrestricted Test Team" },
    userAuth: { accessToken },
  });
  expect(createRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "client_metadata": null,
        "client_read_only_metadata": null,
        "display_name": "Unrestricted Test Team",
        "id": "<stripped UUID>",
        "profile_image_url": null,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("persists scopes across a token refresh", async ({ expect }) => {
  const { userId } = await Auth.Password.signUpWithEmail();

  const sessionRes = await createScopedSession(userId, "teams:read");
  expect(sessionRes.status).toBe(200);
  const refreshToken = sessionRes.body.refresh_token;

  // Roll the access token via the refresh endpoint; the scope must survive the refresh because it
  // is stored on the refresh-token row, not just baked into the original access token.
  const refreshRes = await niceBackendFetch("/api/v1/auth/sessions/current/refresh", {
    accessType: "client",
    method: "POST",
    headers: { "x-stack-refresh-token": refreshToken },
  });
  expect(refreshRes.status).toBe(200);
  const refreshedAccessToken = refreshRes.body.access_token;

  // The freshly minted token is still restricted to `teams:read`.
  const createRes = await niceBackendFetch("/api/v1/teams", {
    accessType: "client",
    method: "POST",
    body: { display_name: "Refreshed Scoped Team" },
    userAuth: { accessToken: refreshedAccessToken },
  });
  expect(createRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": {
        "code": "INSUFFICIENT_SCOPE",
        "details": { "missing_scopes": ["teams:write"] },
        "error": "The access token is missing the following required scope(s): 'teams:write'. Mint a token that includes these scopes and try again.",
      },
      "headers": Headers {
        "x-stack-known-error": "INSUFFICIENT_SCOPE",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("rejects creating a session with an unknown scope", async ({ expect }) => {
  const { userId } = await Auth.Password.signUpWithEmail();

  const sessionRes = await createScopedSession(userId, "teams:read not_a_real:scope");
  expect(sessionRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": { "message": "Unknown scope(s): 'not_a_real:scope'." },
        "error": "Unknown scope(s): 'not_a_real:scope'.",
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});
