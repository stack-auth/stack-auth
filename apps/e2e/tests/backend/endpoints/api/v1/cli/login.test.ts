import { it } from "../../../../../helpers";
import { niceBackendFetch } from "../../../../backend-helpers";

it("should set the refresh token for a CLI auth attempt and return success when polling", async ({ expect }) => {
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
  const pollingCode = createResponse.body.polling_code;
  const refreshToken = "test-refresh-token";

  // Then set the refresh token
  const loginResponse = await niceBackendFetch("/api/latest/auth/cli/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenancy-ID": "test-tenancy-id",
    },
    body: { login_code: loginCode, refresh_token: refreshToken },
  });

  expect(loginResponse.status).toBe(200);

  // Then poll for the status
  const pollResponse = await niceBackendFetch("/api/latest/auth/cli/poll", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenancy-ID": "test-tenancy-id",
    },
    body: { polling_code: pollingCode },
  });

  expect(pollResponse.status).toBe(201);
  expect(pollResponse.body).toHaveProperty("status", "success");
  expect(pollResponse.body).toHaveProperty("refresh_token", refreshToken);

  // Polling again should return 'used' status
  const pollAgainResponse = await niceBackendFetch("/api/latest/auth/cli/poll", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenancy-ID": "test-tenancy-id",
    },
    body: { polling_code: pollingCode },
  });

  expect(pollAgainResponse.status).toBe(200);
  expect(pollAgainResponse.body).toHaveProperty("status", "used");
  expect(pollAgainResponse.body).not.toHaveProperty("refresh_token");
});

it("should return an error when trying to set the refresh token with an invalid login code", async ({ expect }) => {
  const refreshToken = "test-refresh-token";

  // Try to set the refresh token with an invalid login code
  const loginResponse = await niceBackendFetch("/api/latest/auth/cli/login", {
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
  const loginResponse1 = await niceBackendFetch("/api/latest/auth/cli/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenancy-ID": "test-tenancy-id",
    },
    body: { login_code: loginCode, refresh_token: refreshToken1 },
  });

  expect(loginResponse1.status).toBe(200);

  // Try to set the refresh token again
  const loginResponse2 = await niceBackendFetch("/api/latest/auth/cli/login", {
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
