import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { expect } from "vitest";
import { NiceResponse, it } from "../../../../helpers";
import { Auth, InternalApiKey, Project, backendContext, createMailbox, niceBackendFetch } from "../../../backend-helpers";
import { Result } from "@stackframe/stack-shared/dist/utils/results";

async function ensureAnonymousUsersAreStillExcluded(metricsResponse: NiceResponse) {
  for (let i = 0; i < 2; i++) {
    await Auth.Anonymous.signUp();
  }
  await wait(2000); // the event log is async, so let's give it some time to be written to the DB
  const response = await niceBackendFetch("/api/v1/internal/metrics", { accessType: 'admin' });
  expect(response.body).toEqual(metricsResponse.body);
}

it("should return metrics data", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  await wait(3000);  // the event log is async, so let's give it some time to be written to the DB

  const response = await niceBackendFetch("/api/v1/internal/metrics", { accessType: 'admin' });
  expect(response).toMatchSnapshot(`metrics_result_no_users`);

  await ensureAnonymousUsersAreStillExcluded(response);
});

it("should return metrics data with users", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  // this test may run longer than the admin access token is valid for, so let's create API keys
  await InternalApiKey.createAndSetProjectKeys();

  const mailboxes = new Array(10).fill(null).map(() => createMailbox());

  backendContext.set({ mailbox: mailboxes[0], ipData: { country: "AQ", ipAddress: "127.0.0.1", city: "[placeholder city]", region: "NQ", latitude: 68, longitude: 30, tzIdentifier: "Europe/Zurich" } });
  await Auth.Otp.signIn();

  for (const mailbox of mailboxes) {
    backendContext.set({ mailbox, ipData: undefined });
    await Auth.Otp.signIn();
  }
  backendContext.set({ mailbox: mailboxes[8] });
  await Auth.Otp.signIn();
  const deleteResponse = await niceBackendFetch("/api/v1/users/me", {
    accessType: "server",
    method: "DELETE",
  });
  expect(deleteResponse.status).toBe(200);
  backendContext.set({ userAuth: { ...backendContext.value.userAuth, accessToken: undefined } });

  backendContext.set({ mailbox: mailboxes[1], ipData: { country: "CH", ipAddress: "127.0.0.1", city: "Zurich", region: "ZH", latitude: 47.3769, longitude: 8.5417, tzIdentifier: "Europe/Zurich" } });
  await Auth.Otp.signIn();
  backendContext.set({ mailbox: mailboxes[1], ipData: { country: "AQ", ipAddress: "127.0.0.1", city: "[placeholder city]", region: "NQ", latitude: 68, longitude: 30, tzIdentifier: "Europe/Zurich" } });
  await Auth.Otp.signIn();
  backendContext.set({ mailbox: mailboxes[2], ipData: { country: "CH", ipAddress: "127.0.0.1", city: "Zurich", region: "ZH", latitude: 47.3769, longitude: 8.5417, tzIdentifier: "Europe/Zurich" } });
  await Auth.Otp.signIn();

  await wait(3000);  // the event log is async, so let's give it some time to be written to the DB

  const response = await niceBackendFetch("/api/v1/internal/metrics", { accessType: 'admin' });
  expect(response).toMatchSnapshot();

  await ensureAnonymousUsersAreStillExcluded(response);
}, {
  timeout: 120_000,
});

it("should not work for non-admins", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  await Auth.Otp.signIn();

  await wait(3000);  // the event log is async, so let's give it some time to be written to the DB

  const response = await niceBackendFetch("/api/v1/internal/metrics", { accessType: 'server' });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "INSUFFICIENT_ACCESS_TYPE",
        "details": {
          "actual_access_type": "server",
          "allowed_access_types": ["admin"],
        },
        "error": "The x-stack-access-type header must be 'admin', but was 'server'.",
      },
      "headers": Headers {
        "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
        <some fields may have been hidden>,
      },
    }
  `);

});

it("should exclude anonymous users from metrics", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  await InternalApiKey.createAndSetProjectKeys();

  // Create 1 regular user
  backendContext.set({ mailbox: createMailbox(), ipData: { country: "US", ipAddress: "127.0.0.1", city: "New York", region: "NY", latitude: 40.7128, longitude: -74.0060, tzIdentifier: "America/New_York" } });
  await Auth.Otp.signIn();

  // Store metrics so we can compare them later
  const beforeMetrics = await niceBackendFetch("/api/v1/internal/metrics", { accessType: 'admin' });

  // Create 2 anonymous users
  for (let i = 0; i < 2; i++) {
    await Auth.Anonymous.signUp();
  }

  // the event log is async, so let's give it some time to be written to the DB
  const result = await Result.retry(async () => {
    const response = await niceBackendFetch("/api/v1/internal/metrics", { accessType: 'admin' });
    if (JSON.stringify(response.body) === JSON.stringify(beforeMetrics.body)) {
      return Result.ok(response);
    }
    return Result.error(response);
  }, 5, { exponentialDelayBase: 200 });

  if (result.status === "error") {
    expect(beforeMetrics.body).toEqual(result.error);
    throw new Error("Metrics response mismatch, should never be reached");
  }

  // Verify that total_users only counts the 1 regular user, not the anonymous ones
  expect(result.data.body.total_users).toBe(1);

  // Verify anonymous users don't appear in recently_registered
  expect(result.data.body.recently_registered.length).toBe(1);
  expect(result.data.body.recently_registered.every((user: any) => !user.is_anonymous)).toBe(true);

  // Verify anonymous users don't appear in recently_active
  expect(result.data.body.recently_active.every((user: any) => !user.is_anonymous)).toBe(true);

  // Verify anonymous users aren't counted in daily_users
  const lastDayUsers = result.data.body.daily_users[result.data.body.daily_users.length - 1];
  expect(lastDayUsers.activity).toBe(1);

  // Verify users_by_country only includes regular users
  expect(result.data.body.users_by_country["US"]).toBe(1);

  await ensureAnonymousUsersAreStillExcluded(result.data);
});

it("should handle anonymous users with activity correctly", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  await InternalApiKey.createAndSetProjectKeys();

  // Create 1 regular user with activity
  const regularMailbox = createMailbox();
  backendContext.set({ mailbox: regularMailbox, ipData: { country: "CA", ipAddress: "127.0.0.1", city: "Toronto", region: "ON", latitude: 43.6532, longitude: -79.3832, tzIdentifier: "America/Toronto" } });
  await Auth.Otp.signIn();

  // Generate some activity for regular user
  await niceBackendFetch("/api/v1/users/me", { accessType: 'client' });

  // Create 3 anonymous users with activity
  for (let i = 0; i < 3; i++) {
    await Auth.Anonymous.signUp();
  }

  await wait(3000);  // the event log is async, so let's give it some time to be written to the DB

  const response = await niceBackendFetch("/api/v1/internal/metrics", { accessType: 'admin' });

  // Should only count 1 regular user
  expect(response.body.total_users).toBe(1);

  // Daily active users should only count regular users
  const todayDAU = response.body.daily_active_users[response.body.daily_active_users.length - 1];
  expect(todayDAU.activity).toBe(1);

  // Users by country should only count regular users
  expect(response.body.users_by_country["CA"]).toBe(1);
  expect(response.body.users_by_country["US"]).toBeUndefined();

  await ensureAnonymousUsersAreStillExcluded(response);
});

it("should handle mixed auth methods excluding anonymous users", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
      credential_enabled: true,
    }
  });

  await InternalApiKey.createAndSetProjectKeys();

  // Create users with different auth methods
  const regularMailbox = createMailbox();

  // Regular user with OTP
  backendContext.set({ mailbox: regularMailbox });
  await Auth.Otp.signIn();

  // Regular user with password
  const passwordMailbox = createMailbox();
  backendContext.set({ mailbox: passwordMailbox });
  await Auth.Password.signUpWithEmail({ password: "test1234" });

  // Anonymous users (should not be counted)
  for (let i = 0; i < 5; i++) {
    await Auth.Anonymous.signUp();
  }

  await wait(3000);

  const response = await niceBackendFetch("/api/v1/internal/metrics", { accessType: 'admin' });

  // Should only count 2 regular users
  expect(response.body.total_users).toBe(2);

  // Login methods should only count regular users' methods
  const loginMethods = response.body.login_methods;
  const totalMethodCount = loginMethods.reduce((sum: number, method: any) => sum + method.count, 0);
  expect(totalMethodCount).toBe(2); // 1 OTP + 1 password, no anonymous

  await ensureAnonymousUsersAreStillExcluded(response);
});
