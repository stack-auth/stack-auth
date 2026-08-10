import { it } from "../../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../../backend-helpers";

async function listAuditLog(options?: { action?: string, targetUserId?: string, cursor?: string, limit?: number }) {
  return await niceBackendFetch("/api/v1/internal/audit-log", {
    method: "GET",
    accessType: "admin",
    query: {
      ...(options?.action != null ? { action: options.action } : {}),
      ...(options?.targetUserId != null ? { target_user_id: options.targetUserId } : {}),
      ...(options?.cursor != null ? { cursor: options.cursor } : {}),
      ...(options?.limit != null ? { limit: String(options.limit) } : {}),
    },
  });
}

it("forbids listing when Audit Log is not enabled", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });

  const res = await listAuditLog();
  expect(res.status).toBe(403);
  expect(res.body).toEqual("Audit Log is not enabled for this project.");
});

it("does not write events when Audit Log is disabled", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  const signUp = await Auth.Password.signUpWithEmail();

  const impersonation = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "server",
    method: "POST",
    body: {
      user_id: signUp.userId,
      is_impersonation: true,
      reason: "should not be stored",
    },
  });
  expect(impersonation.status).toBe(200);

  await Project.updateConfig({ "apps.installed.audit-log.enabled": true });
  const listRes = await listAuditLog();
  expect(listRes.status).toBe(200);
  expect(listRes.body.items).toEqual([]);
});

it("records impersonation started with reason and actor when enabled", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ "apps.installed.audit-log.enabled": true });
  const signUp = await Auth.Password.signUpWithEmail();

  const impersonation = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "server",
    method: "POST",
    body: {
      user_id: signUp.userId,
      is_impersonation: true,
      reason: " Investigating billing issue ",
    },
  });
  expect(impersonation.status).toBe(200);

  const listRes = await listAuditLog();
  expect(listRes.status).toBe(200);
  expect(listRes.body.items).toHaveLength(1);
  expect(listRes.body.items[0]).toMatchObject({
    action: "impersonation.started",
    actor_type: "server_key",
    actor_label: "Server API key",
    actor_user_id: null,
    target_user_id: signUp.userId,
    reason: "Investigating billing issue",
  });
  expect(listRes.body.items[0].metadata).toMatchObject({
    source: "auth.sessions",
  });
  expect(typeof listRes.body.items[0].metadata.refresh_token_id).toBe("string");
});

it("records impersonation revoked when an impersonation session is deleted", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ "apps.installed.audit-log.enabled": true });
  const signUp = await Auth.Password.signUpWithEmail();

  const impersonation = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "server",
    method: "POST",
    body: {
      user_id: signUp.userId,
      is_impersonation: true,
      reason: "support",
    },
  });
  expect(impersonation.status).toBe(200);

  const sessions = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "admin",
    method: "GET",
    query: {
      user_id: signUp.userId,
    },
  });
  expect(sessions.status).toBe(200);
  const impersonationSession = sessions.body.items.find((session: { is_impersonation: boolean }) => session.is_impersonation);
  expect(impersonationSession).toBeDefined();

  const revoke = await niceBackendFetch(`/api/v1/auth/sessions/${impersonationSession.id}`, {
    accessType: "admin",
    method: "DELETE",
    query: {
      user_id: signUp.userId,
    },
  });
  expect(revoke.status).toBe(200);

  const listRes = await listAuditLog({ action: "impersonation.revoked" });
  expect(listRes.status).toBe(200);
  expect(listRes.body.items).toHaveLength(1);
  expect(listRes.body.items[0]).toMatchObject({
    action: "impersonation.revoked",
    target_user_id: signUp.userId,
    actor_type: "unknown",
    actor_label: "Admin API key",
  });
});

it("ignores reason on non-impersonation session creation", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ "apps.installed.audit-log.enabled": true });
  const signUp = await Auth.Password.signUpWithEmail();

  const session = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "server",
    method: "POST",
    body: {
      user_id: signUp.userId,
      is_impersonation: false,
      reason: "not an impersonation",
    },
  });
  expect(session.status).toBe(200);

  const listRes = await listAuditLog();
  expect(listRes.status).toBe(200);
  expect(listRes.body.items).toEqual([]);
});

it("records project settings config updates with non-sensitive before/after values", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  // Enabling Audit Log while it is off must not self-audit (progressive gate
  // uses the pre-update tenancy).
  await Project.updateConfig({ "apps.installed.audit-log.enabled": true });

  // Establish a known before value — defaults/create may already set this true.
  await Project.updateConfig({ "auth.password.allowSignIn": false });
  await Project.updateConfig({ "auth.password.allowSignIn": true });

  const listRes = await listAuditLog({ action: "project_settings.updated" });
  expect(listRes.status).toBe(200);
  expect(listRes.body.items.length).toBeGreaterThanOrEqual(2);
  expect(listRes.body.items[0]).toMatchObject({
    action: "project_settings.updated",
    target_user_id: null,
    actor_type: "unknown",
    actor_label: "Admin API key",
  });
  expect(listRes.body.items[0].metadata).toMatchObject({
    source: "config.override.patch",
    level: "environment",
    write_mode: "merge",
    changes: {
      "auth.password.allowSignIn": {
        before: false,
        after: true,
      },
    },
  });
  expect(listRes.body.items[0].metadata.changed_paths).toContain("auth.password.allowSignIn");
  expect(listRes.body.items[0].metadata.changed_paths.every((path: unknown) => typeof path === "string")).toBe(true);
});

it("records project metadata updates from projects/current with before/after", async ({ expect }) => {
  const created = await Project.createAndSwitch({
    display_name: "Original Project Name",
    config: { magic_link_enabled: true },
  });
  expect(created.createProjectResponse.body.display_name).toBe("Original Project Name");
  await Project.updateConfig({ "apps.installed.audit-log.enabled": true });

  const update = await niceBackendFetch("/api/v1/internal/projects/current", {
    accessType: "admin",
    method: "PATCH",
    body: {
      display_name: "Audited Project Name",
    },
  });
  expect(update.status).toBe(200);

  const listRes = await listAuditLog({ action: "project_settings.updated" });
  expect(listRes.status).toBe(200);
  expect(listRes.body.items).toHaveLength(1);
  expect(listRes.body.items[0]).toMatchObject({
    action: "project_settings.updated",
    target_user_id: null,
    metadata: {
      source: "projects.current.update",
      write_mode: "merge",
      changed_paths: ["display_name"],
      changes: {
        display_name: {
          before: "Original Project Name",
          after: "Audited Project Name",
        },
      },
    },
  });
});

it("does not persist values for sensitive config leaves", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ "apps.installed.audit-log.enabled": true });

  await Project.updateConfig({
    "emails.server": {
      isShared: false,
      provider: "smtp",
      host: "smtp.example.com",
      port: 587,
      username: "mailer",
      password: "super-secret-password",
      senderName: "Example",
      senderEmail: "noreply@example.com",
    },
  });

  const listRes = await listAuditLog({ action: "project_settings.updated" });
  expect(listRes.status).toBe(200);
  expect(listRes.body.items).toHaveLength(1);
  const event = listRes.body.items[0];
  expect(event.metadata.changed_paths).toContain("emails.server.password");
  // Sensitive leaf: path is recorded, before/after are not.
  expect(event.metadata.changes?.["emails.server.password"]).toBeUndefined();
  // Non-sensitive sibling leaves still get values.
  expect(event.metadata.changes?.["emails.server.host"]).toMatchObject({
    after: "smtp.example.com",
  });
  expect(JSON.stringify(event.metadata)).not.toContain("super-secret-password");
});
