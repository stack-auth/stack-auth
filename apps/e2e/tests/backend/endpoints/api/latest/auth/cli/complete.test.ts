import { it } from "../../../../../../helpers";
import { niceBackendFetch } from "../../../../../backend-helpers";

it("should set the refresh token for a CLI auth attempt and return success when polling", async ({ expect }) => {
  // First, create a new CLI auth attempt
  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "admin",
    body: {},
  });

  const refreshToken = "test-refresh-token";

  // Then set the refresh token
  const loginResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "admin",
    body: { login_code: createResponse.body.login_code, refresh_token: refreshToken },
  });
  expect(loginResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Then poll for the status
  const pollResponse = await niceBackendFetch("/api/latest/auth/cli/poll", {
    method: "POST",
    accessType: "admin",
    body: { polling_code: createResponse.body.polling_code },
  });

  expect(pollResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "refresh_token": <stripped field 'refresh_token'>,
        "status": "success",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // // Polling again should return 'used' status

  const pollResponse2 = await niceBackendFetch("/api/latest/auth/cli/poll", {
    method: "POST",
    accessType: "admin",
    body: { polling_code: createResponse.body.polling_code },
  });

  expect(pollResponse2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "status": "used" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

it("should return an error when trying to set the refresh token with an invalid login code", async ({ expect }) => {
  const refreshToken = "test-refresh-token";

  // Try to set the refresh token with an invalid login code
  const loginResponse = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenancy-ID": "test-tenancy-id",
    },
    body: { login_code: "invalid-login-code", refresh_token: refreshToken },
  });

  expect(loginResponse.status).toBe(400);
  expect(loginResponse.headers.get("X-Stack-Known-Error")).toBe("SCHEMA_ERROR");
});

it("should not allow setting the refresh token twice", async ({ expect }) => {
  // First, create a new CLI auth attempt
  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenancy-ID": "test-tenancy-id",
    },
    body: {},
  });

  const loginCode = createResponse.body.login_code;
  const refreshToken1 = "test-refresh-token-1";
  const refreshToken2 = "test-refresh-token-2";

  // Set the refresh token the first time
  const loginResponse1 = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenancy-ID": "test-tenancy-id",
    },
    body: { login_code: loginCode, refresh_token: refreshToken1 },
  });

  expect(loginResponse1.status).toBe(200);

  // Try to set the refresh token again
  const loginResponse2 = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenancy-ID": "test-tenancy-id",
    },
    body: { login_code: loginCode, refresh_token: refreshToken2 },
  });

  expect(loginResponse2.status).toBe(400);
  expect(loginResponse2.headers.get("X-Stack-Known-Error")).toBe("SCHEMA_ERROR");
});
