import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { randomUUID } from "node:crypto";
import { it } from "../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../backend-helpers";

// Matches USER_ACTIVITY_WINDOW_DAYS in
// apps/backend/src/app/api/latest/internal/user-activity/route.tsx.
// When that constant changes, bump this one too.
const USER_ACTIVITY_WINDOW_DAYS = 22 * 16;

it("should return an empty activity heatmap for an unknown user", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    },
  });

  const response = await niceBackendFetch(
    `/api/v1/internal/user-activity?user_id=${randomUUID()}`,
    { accessType: "admin" },
  );

  expect(response.status).toBe(200);
  expect(Array.isArray(response.body.data_points)).toBe(true);
  expect(response.body.data_points).toHaveLength(USER_ACTIVITY_WINDOW_DAYS);
  for (const point of response.body.data_points) {
    expect(typeof point.date).toBe("string");
    expect(point.activity).toBe(0);
  }
});

it("should record activity for a real user that has signed in", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    },
  });

  const { userId } = await Auth.Otp.signIn();

  // ClickHouse ingestion is async; poll until the signed-in user shows up.
  let totalActivity = 0;
  for (let i = 0; i < 15; i += 1) {
    const response = await niceBackendFetch(
      `/api/v1/internal/user-activity?user_id=${userId}`,
      { accessType: "admin" },
    );
    expect(response.status).toBe(200);
    expect(response.body.data_points).toHaveLength(USER_ACTIVITY_WINDOW_DAYS);
    totalActivity = response.body.data_points.reduce(
      (sum: number, point: { activity: number }) => sum + point.activity,
      0,
    );
    if (totalActivity > 0) break;
    await wait(2_000);
  }
  expect(totalActivity).toBeGreaterThan(0);
}, {
  timeout: 60_000,
});

it("should reject non-admin callers", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    },
  });

  const response = await niceBackendFetch(
    `/api/v1/internal/user-activity?user_id=${randomUUID()}`,
    { accessType: "server" },
  );

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
