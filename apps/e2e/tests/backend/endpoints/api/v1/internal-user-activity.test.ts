import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { it } from "../../../../helpers";
import { Auth, InternalApiKey, Project, backendContext, createMailbox, niceBackendFetch } from "../../../backend-helpers";

it("should return user activity data", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  await InternalApiKey.createAndSetProjectKeys();

  const mailbox = createMailbox();
  backendContext.set({ mailbox });
  await Auth.Otp.signIn();

  const meResponse = await niceBackendFetch("/api/v1/users/me", { accessType: 'client' });
  const userId = meResponse.body.id;

  // Generate some activity
  for (let i = 0; i < 5; i++) {
    await niceBackendFetch("/api/v1/users/me", { accessType: 'client' });
    await wait(100);
  }

  await wait(3000);  // the event log is async, so let's give it some time to be written to the DB

  const response = await niceBackendFetch(`/api/v1/internal/users/${userId}/activity`, { accessType: 'admin' });

  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty('activity');
  expect(Array.isArray(response.body.activity)).toBe(true);
  expect(response.body.activity.length).toBeGreaterThan(0);

  // Verify the structure of activity data
  const firstActivity = response.body.activity[0];
  expect(firstActivity).toHaveProperty('date');
  expect(firstActivity).toHaveProperty('count');
  expect(typeof firstActivity.date).toBe('string');
  expect(typeof firstActivity.count).toBe('number');

  // Verify dates are in correct format (YYYY-MM-DD)
  expect(firstActivity.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  // Verify activity is for the past year (365 days)
  expect(response.body.activity.length).toBeGreaterThanOrEqual(365);
  expect(response.body.activity.length).toBeLessThanOrEqual(366); // leap year
});

it("should return zero activity for new user", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  await InternalApiKey.createAndSetProjectKeys();

  const mailbox = createMailbox();
  backendContext.set({ mailbox });
  await Auth.Otp.signIn();

  const meResponse = await niceBackendFetch("/api/v1/users/me", { accessType: 'client' });
  const userId = meResponse.body.id;

  await wait(3000);  // the event log is async, so let's give it some time to be written to the DB

  const response = await niceBackendFetch(`/api/v1/internal/users/${userId}/activity`, { accessType: 'admin' });

  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty('activity');
  expect(Array.isArray(response.body.activity)).toBe(true);

  // Most days should have 0 activity for a new user
  const zeroActivityDays = response.body.activity.filter((day: any) => day.count === 0);
  expect(zeroActivityDays.length).toBeGreaterThan(360); // Most days should be zero

  // Today or recent days might have some activity from sign-in
  const recentActivityDays = response.body.activity.filter((day: any) => day.count > 0);
  expect(recentActivityDays.length).toBeGreaterThanOrEqual(0);
  expect(recentActivityDays.length).toBeLessThan(10); // Not many days with activity
});

it("should track activity across multiple days", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  await InternalApiKey.createAndSetProjectKeys();

  const mailbox = createMailbox();
  backendContext.set({ mailbox });
  await Auth.Otp.signIn();

  const meResponse = await niceBackendFetch("/api/v1/users/me", { accessType: 'client' });
  const userId = meResponse.body.id;

  // Generate activity
  for (let i = 0; i < 10; i++) {
    await niceBackendFetch("/api/v1/users/me", { accessType: 'client' });
    await wait(50);
  }

  await wait(3000);  // the event log is async, so let's give it some time to be written to the DB

  const response = await niceBackendFetch(`/api/v1/internal/users/${userId}/activity`, { accessType: 'admin' });

  expect(response.status).toBe(200);

  // Find today's activity
  const today = new Date().toISOString().split('T')[0];
  const todayActivity = response.body.activity.find((day: any) => day.date === today);

  expect(todayActivity).toBeDefined();
  expect(todayActivity.count).toBeGreaterThan(0);
});

it("should not work for non-admins", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  const mailbox = createMailbox();
  backendContext.set({ mailbox });
  await Auth.Otp.signIn();

  const meResponse = await niceBackendFetch("/api/v1/users/me", { accessType: 'client' });
  const userId = meResponse.body.id;

  await wait(3000);  // the event log is async, so let's give it some time to be written to the DB

  const clientResponse = await niceBackendFetch(`/api/v1/internal/users/${userId}/activity`, { accessType: 'client' });
  expect(clientResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "INSUFFICIENT_ACCESS_TYPE",
        "details": {
          "actual_access_type": "client",
          "allowed_access_types": ["admin"],
        },
        "error": "The x-stack-access-type header must be 'admin', but was 'client'.",
      },
      "headers": Headers {
        "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
        <some fields may have been hidden>,
      },
    }
  `);

  const serverResponse = await niceBackendFetch(`/api/v1/internal/users/${userId}/activity`, { accessType: 'server' });
  expect(serverResponse).toMatchInlineSnapshot(`
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

it("should not track anonymous user activity", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  await InternalApiKey.createAndSetProjectKeys();

  // Create a regular user
  const mailbox = createMailbox();
  backendContext.set({ mailbox });
  await Auth.Otp.signIn();

  const meResponse = await niceBackendFetch("/api/v1/users/me", { accessType: 'client' });
  const userId = meResponse.body.id;

  // Generate activity for regular user
  for (let i = 0; i < 5; i++) {
    await niceBackendFetch("/api/v1/users/me", { accessType: 'client' });
    await wait(100);
  }

  // Create an anonymous user and generate activity
  await Auth.Anonymous.signUp();
  for (let i = 0; i < 10; i++) {
    await niceBackendFetch("/api/v1/users/me", { accessType: 'client' });
    await wait(100);
  }

  await wait(3000);  // the event log is async, so let's give it some time to be written to the DB

  // Check the regular user's activity - should only include their own activity
  const response = await niceBackendFetch(`/api/v1/internal/users/${userId}/activity`, { accessType: 'admin' });

  expect(response.status).toBe(200);

  // Find today's activity for the regular user
  const today = new Date().toISOString().split('T')[0];
  const todayActivity = response.body.activity.find((day: any) => day.date === today);

  // The activity count should reflect only the regular user's activity, not the anonymous user
  expect(todayActivity).toBeDefined();
  expect(todayActivity.count).toBeGreaterThan(0);
  expect(todayActivity.count).toBeLessThan(15); // Should not include anonymous user's 10 activities
});

it("should handle user with no activity gracefully", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  await InternalApiKey.createAndSetProjectKeys();

  const mailbox = createMailbox();
  backendContext.set({ mailbox });
  await Auth.Otp.signIn();

  const meResponse = await niceBackendFetch("/api/v1/users/me", { accessType: 'client' });
  const userId = meResponse.body.id;

  // Don't generate any additional activity, just the sign-in

  await wait(3000);  // the event log is async, so let's give it some time to be written to the DB

  const response = await niceBackendFetch(`/api/v1/internal/users/${userId}/activity`, { accessType: 'admin' });

  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty('activity');
  expect(Array.isArray(response.body.activity)).toBe(true);
  expect(response.body.activity.length).toBeGreaterThanOrEqual(365);

  // All activity entries should be valid, even if count is 0
  response.body.activity.forEach((day: any) => {
    expect(day).toHaveProperty('date');
    expect(day).toHaveProperty('count');
    expect(typeof day.count).toBe('number');
    expect(day.count).toBeGreaterThanOrEqual(0);
  });
});

