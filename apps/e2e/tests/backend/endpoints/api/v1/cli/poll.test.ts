import { it } from "../../../../../helpers";
import { niceBackendFetch } from "../../../../backend-helpers";

it("should return 'waiting' status when polling for a new CLI auth attempt", async ({ expect }) => {
  // First, create a new CLI auth attempt
  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenancy-ID": "test-tenancy-id",
    },
    body: {},
  });

  const pollingCode = createResponse.body.polling_code;

  // Then poll for the status
  const pollResponse = await niceBackendFetch("/api/latest/auth/cli/poll", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenancy-ID": "test-tenancy-id",
    },
    body: { polling_code: pollingCode },
  });

  expect(pollResponse.status).toBe(200);
  expect(pollResponse.body).toHaveProperty("status", "waiting");
  expect(pollResponse.body).not.toHaveProperty("refresh_token");
});

it("should return 400 with INVALID_POLLING_CODE error when polling with an invalid code", async ({ expect }) => {
  const pollResponse = await niceBackendFetch("/api/latest/auth/cli/poll", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenancy-ID": "test-tenancy-id",
    },
    body: { polling_code: "invalid-code" },
  });

  expect(pollResponse.status).toBe(400);
  expect(pollResponse.headers.get("X-Stack-Known-Error")).toBe("INVALID_POLLING_CODE");
  expect(pollResponse.body).toHaveProperty("code", "INVALID_POLLING_CODE");
  expect(pollResponse.body).toHaveProperty("error", "The polling code is invalid or does not exist.");
});

it("should return 'expired' status when polling for an expired CLI auth attempt", async ({ expect }) => {
  // First, create a new CLI auth attempt with a very short expiration time
  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenancy-ID": "test-tenancy-id",
    },
    body: {
      expires_in_millis: 1000, // 1 second
    },
  });

  const pollingCode = createResponse.body.polling_code;

  // Wait for the CLI auth attempt to expire
  await new Promise(resolve => setTimeout(resolve, 1500)); // Wait 1.5 seconds

  // Then poll for the status
  const pollResponse = await niceBackendFetch("/api/latest/auth/cli/poll", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenancy-ID": "test-tenancy-id",
    },
    body: { polling_code: pollingCode },
  });

  expect(pollResponse.status).toBe(200);
  expect(pollResponse.body).toHaveProperty("status", "expired");
  expect(pollResponse.body).not.toHaveProperty("refresh_token");
});
