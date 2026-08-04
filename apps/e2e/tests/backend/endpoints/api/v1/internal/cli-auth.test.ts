import { it } from "../../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../../backend-helpers";

it("returns bounded CLI authentication metrics without exposing login secrets", async ({ expect }) => {
  await Project.createAndSwitch();

  const createdAttempt = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "server",
    body: {},
  });
  expect(createdAttempt.status).toBe(200);

  const response = await niceBackendFetch("/api/latest/internal/cli-auth", {
    method: "GET",
    accessType: "admin",
  });

  expect(response.status).toBe(200);
  expect(response.body.summary).toEqual({
    attempts_in_window: 1,
    completed_attempts_in_window: 0,
    used_attempts_in_window: 0,
    expired_attempts_in_window: 0,
    pending_attempts_in_window: 1,
    active_tokens_in_lookup_window: 0,
    attempt_window_limit: 50,
    active_token_lookup_window_limit: 200,
  });
  expect(response.body.recent_attempts).toHaveLength(1);
  expect(response.body.recent_attempts[0]).toMatchObject({
    status: "pending",
    used_at: null,
  });
  expect(response.body.recent_attempts[0].id).toEqual(expect.any(String));
  expect(response.body.recent_attempts[0].created_at).toEqual(expect.any(String));
  expect(response.body.recent_attempts[0].expires_at).toEqual(expect.any(String));
  expect(response.body.active_cli_users).toEqual([]);
  expect(JSON.stringify(response.body)).not.toContain(createdAttempt.body.polling_code);
  expect(JSON.stringify(response.body)).not.toContain(createdAttempt.body.login_code);
});

it("returns completed CLI sessions with a count matching the active rows", async ({ expect }) => {
  await Project.createAndSwitch();
  const user = await Auth.fastSignUp();

  const createdAttempt = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "server",
    body: {},
  });
  const completedAttempt = await niceBackendFetch("/api/latest/auth/cli/complete", {
    method: "POST",
    accessType: "server",
    body: {
      login_code: createdAttempt.body.login_code,
      mode: "complete",
      refresh_token: user.refreshToken,
    },
  });
  expect(completedAttempt.status).toBe(200);

  const polledAttempt = await niceBackendFetch("/api/latest/auth/cli/poll", {
    method: "POST",
    accessType: "server",
    body: { polling_code: createdAttempt.body.polling_code },
  });
  expect(polledAttempt.status).toBe(201);

  const response = await niceBackendFetch("/api/latest/internal/cli-auth", {
    method: "GET",
    accessType: "admin",
  });

  expect(response.status).toBe(200);
  expect(response.body.summary.active_tokens_in_lookup_window).toBe(1);
  expect(response.body.active_cli_users).toHaveLength(1);
  expect(response.body.active_cli_users[0]).toMatchObject({
    user_id: user.userId,
    is_expired: false,
  });
  expect(response.body.active_cli_users.filter((session: { is_expired: boolean }) => !session.is_expired)).toHaveLength(
    response.body.summary.active_tokens_in_lookup_window,
  );
});
