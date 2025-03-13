import { it } from "../../../../../../helpers";
import { niceBackendFetch } from "../../../../../backend-helpers";

it("should create a new CLI auth attempt", async ({ expect }) => {
  const response = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "server",
    body: {},
  });

  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty("polling_code");
  expect(response.body).toHaveProperty("login_code");
  expect(response.body).toHaveProperty("expires_at");

  // Verify that the expiration time is about 2 hours from now
  const expiresAt = new Date(response.body.expires_at);
  const now = new Date();
  const twoHoursInMs = 2 * 60 * 60 * 1000;
  expect(expiresAt.getTime() - now.getTime()).toBeGreaterThan(twoHoursInMs - 10000); // Allow for a small margin of error
  expect(expiresAt.getTime() - now.getTime()).toBeLessThan(twoHoursInMs + 10000); // Allow for a small margin of error
});

it("should create a new CLI auth attempt with custom expiration time", async ({ expect }) => {
  const customExpirationMs = 30 * 60 * 1000; // 30 minutes

  const response = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "server",
    body: {
      expires_in_millis: customExpirationMs,
    },
  });

  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty("polling_code");
  expect(response.body).toHaveProperty("login_code");
  expect(response.body).toHaveProperty("expires_at");

  // Verify that the expiration time is about 30 minutes from now
  const expiresAt = new Date(response.body.expires_at);
  const now = new Date();
  expect(expiresAt.getTime() - now.getTime()).toBeGreaterThan(customExpirationMs - 10000); // Allow for a small margin of error
  expect(expiresAt.getTime() - now.getTime()).toBeLessThan(customExpirationMs + 10000); // Allow for a small margin of error
});
