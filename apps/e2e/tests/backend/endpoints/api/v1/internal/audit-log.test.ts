import { it } from "../../../../../helpers";
import { Auth, InternalApiKey, Project, niceBackendFetch } from "../../../../backend-helpers";

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

it("lists admin audit events without requiring Compliance app", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });

  const res = await listAuditLog();
  expect(res.status).toBe(200);
  expect(res.body.items).toEqual([]);
});

it("always writes impersonation events without enabling any app", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  const signUp = await Auth.Password.signUpWithEmail();

  const impersonation = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "server",
    method: "POST",
    body: {
      user_id: signUp.userId,
      is_impersonation: true,
      reason: "always on",
    },
  });
  expect(impersonation.status).toBe(200);

  const listRes = await listAuditLog();
  expect(listRes.status).toBe(200);
  expect(listRes.body.items).toHaveLength(1);
  expect(listRes.body.items[0]).toMatchObject({
    action: "impersonation.started",
    target_user_id: signUp.userId,
    reason: "always on",
  });
});

it("records impersonation started with reason and actor", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
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

it("audits oauth provider enable/disable without empty shared-schema noise", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });

  await Project.updateConfig({
    "auth.oauth.providers.google": {
      type: "google",
      isShared: true,
      allowSignIn: true,
      allowConnectedAccounts: true,
    },
  });
  await Project.updateConfig({
    "auth.oauth.providers.linkedin": {
      type: "linkedin",
      isShared: false,
      clientId: "linkedin-client-id",
      clientSecret: "linkedin-client-secret",
      // Shared provider-bag leftovers the Auth Methods form can send as "".
      facebookConfigId: "",
      microsoftTenantId: "",
      allowSignIn: true,
      allowConnectedAccounts: true,
    },
  });
  await Project.updateConfig({
    "auth.oauth.providers.google": null,
  });

  const listRes = await listAuditLog({ action: "project_settings.updated" });
  expect(listRes.status).toBe(200);

  const linkedinEnable = listRes.body.items.find((item: { metadata?: { changed_paths?: string[] } }) => (
    item.metadata?.changed_paths?.some((path) => path.startsWith("auth.oauth.providers.linkedin."))
  ));
  expect(linkedinEnable).toBeDefined();
  expect(linkedinEnable.metadata.changed_paths).toEqual(expect.arrayContaining([
    "auth.oauth.providers.linkedin.type",
    "auth.oauth.providers.linkedin.clientId",
    "auth.oauth.providers.linkedin.clientSecret",
  ]));
  expect(linkedinEnable.metadata.changed_paths).not.toContain("auth.oauth.providers.linkedin.facebookConfigId");
  expect(linkedinEnable.metadata.changed_paths).not.toContain("auth.oauth.providers.linkedin.microsoftTenantId");
  expect(linkedinEnable.metadata.changes?.["auth.oauth.providers.linkedin.clientId"]).toMatchObject({
    before: null,
    after: "linkedin-client-id",
  });
  expect(linkedinEnable.metadata.changes?.["auth.oauth.providers.linkedin.clientSecret"]).toBeUndefined();
  expect(JSON.stringify(linkedinEnable.metadata)).not.toContain("linkedin-client-secret");

  const googleDisable = listRes.body.items.find((item: { metadata?: { changed_paths?: string[] } }) => (
    item.metadata?.changed_paths?.includes("auth.oauth.providers.google")
  ));
  expect(googleDisable).toMatchObject({
    action: "project_settings.updated",
    metadata: {
      changed_paths: ["auth.oauth.providers.google"],
      changes: {
        "auth.oauth.providers.google": {
          before: "google",
          after: null,
        },
      },
    },
  });
});

it("does not audit end-user password signup (programmatic user create)", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Password.signUpWithEmail();

  const listRes = await listAuditLog();
  expect(listRes.status).toBe(200);
  expect(listRes.body.items).toEqual([]);
});

it("records Authentication user-directory admin actions", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });

  const created = await niceBackendFetch("/api/v1/users", {
    accessType: "admin",
    method: "POST",
    body: {
      primary_email: "audited-user@example.com",
      primary_email_verified: true,
      // Password-reset lookup only finds contact channels with used_for_auth.
      primary_email_auth_enabled: true,
      password: "password123",
      display_name: "Audited User",
    },
  });
  expect(created.status).toBe(201);
  const userId = created.body.id as string;

  const restrict = await niceBackendFetch(`/api/v1/users/${userId}`, {
    accessType: "admin",
    method: "PATCH",
    body: {
      restricted_by_admin: true,
      restricted_by_admin_reason: "Suspicious activity",
    },
  });
  expect(restrict.status).toBe(200);

  const setPassword = await niceBackendFetch(`/api/v1/users/${userId}`, {
    accessType: "admin",
    method: "PATCH",
    body: {
      password: "new-password-456",
    },
  });
  expect(setPassword.status).toBe(200);

  const enableMfa = await niceBackendFetch(`/api/v1/users/${userId}`, {
    accessType: "admin",
    method: "PATCH",
    body: {
      totp_secret_base64: "ZXhhbXBsZSB2YWx1ZQ==",
    },
  });
  expect(enableMfa.status).toBe(200);

  const removeMfa = await niceBackendFetch(`/api/v1/users/${userId}`, {
    accessType: "admin",
    method: "PATCH",
    body: {
      totp_secret_base64: null,
    },
  });
  expect(removeMfa.status).toBe(200);

  const updateProfile = await niceBackendFetch(`/api/v1/users/${userId}`, {
    accessType: "admin",
    method: "PATCH",
    body: {
      display_name: "Renamed Audited User",
    },
  });
  expect(updateProfile.status).toBe(200);

  const unrestrict = await niceBackendFetch(`/api/v1/users/${userId}`, {
    accessType: "admin",
    method: "PATCH",
    body: {
      restricted_by_admin: false,
    },
  });
  expect(unrestrict.status).toBe(200);

  const contactChannel = await niceBackendFetch("/api/v1/contact-channels", {
    accessType: "admin",
    method: "POST",
    body: {
      user_id: userId,
      type: "email",
      value: "secondary-audit@example.com",
      is_verified: false,
      used_for_auth: false,
    },
  });
  expect(contactChannel.status).toBe(201);
  const contactChannelId = contactChannel.body.id as string;

  const updateChannel = await niceBackendFetch(`/api/v1/contact-channels/${userId}/${contactChannelId}`, {
    accessType: "admin",
    method: "PATCH",
    body: {
      used_for_auth: false,
      is_primary: false,
    },
  });
  expect(updateChannel.status).toBe(200);

  const sendVerification = await niceBackendFetch(`/api/v1/contact-channels/${userId}/${contactChannelId}/send-verification-code`, {
    accessType: "admin",
    method: "POST",
    body: {
      callback_url: "http://localhost:12345/some-callback-url",
    },
  });
  expect(sendVerification.status).toBe(200);

  const sendReset = await niceBackendFetch("/api/v1/auth/password/send-reset-code", {
    accessType: "admin",
    method: "POST",
    body: {
      email: "audited-user@example.com",
      callback_url: "http://localhost:12345/some-callback-url",
    },
  });
  expect(sendReset.status).toBe(200);

  const invitation = await niceBackendFetch("/api/v1/internal/send-sign-in-invitation", {
    accessType: "admin",
    method: "POST",
    body: {
      email: "invitee-audit@example.com",
      callback_url: "http://localhost:12345/some-callback-url",
    },
  });
  expect(invitation.status).toBe(200);

  const deleteChannel = await niceBackendFetch(`/api/v1/contact-channels/${userId}/${contactChannelId}`, {
    accessType: "admin",
    method: "DELETE",
  });
  expect(deleteChannel.status).toBe(200);

  const deleted = await niceBackendFetch(`/api/v1/users/${userId}`, {
    accessType: "admin",
    method: "DELETE",
  });
  expect(deleted.status).toBe(200);

  const listRes = await listAuditLog({ targetUserId: userId });
  expect(listRes.status).toBe(200);
  const actions = listRes.body.items.map((item: { action: string }) => item.action);
  expect(actions).toContain("user.created");
  expect(actions).toContain("user.restricted");
  expect(actions).toContain("user.password.set");
  expect(actions).toContain("user.mfa.removed");
  expect(actions).toContain("user.updated");
  expect(actions).toContain("user.unrestricted");
  expect(actions).toContain("contact_channel.created");
  expect(actions).toContain("contact_channel.updated");
  expect(actions).toContain("contact_channel.verification.sent");
  expect(actions).toContain("user.password_reset.sent");
  expect(actions).toContain("contact_channel.deleted");
  expect(actions).toContain("user.deleted");

  const createdEvent = listRes.body.items.find((item: { action: string }) => item.action === "user.created");
  expect(createdEvent.metadata.changed_paths).toEqual(expect.arrayContaining([
    "primary_email",
    "primary_email_verified",
    "display_name",
    "password",
  ]));
  expect(createdEvent.metadata.changes).toMatchObject({
    primary_email: { before: null, after: "audited-user@example.com" },
    display_name: { before: null, after: "Audited User" },
    primary_email_verified: { before: null, after: true },
  });
  // Password: path recorded, value never persisted.
  expect(createdEvent.metadata.changes?.password).toBeUndefined();
  expect(JSON.stringify(createdEvent.metadata)).not.toContain("password123");

  const updated = listRes.body.items.find((item: { action: string }) => item.action === "user.updated");
  expect(updated).toMatchObject({
    action: "user.updated",
    target_user_id: userId,
    metadata: {
      source: "users.update",
      changed_paths: ["display_name"],
      changes: {
        display_name: {
          before: "Audited User",
          after: "Renamed Audited User",
        },
      },
    },
  });

  const restricted = listRes.body.items.find((item: { action: string }) => item.action === "user.restricted");
  expect(restricted).toMatchObject({
    action: "user.restricted",
    target_user_id: userId,
    reason: "Suspicious activity",
  });

  const passwordSet = listRes.body.items.find((item: { action: string }) => item.action === "user.password.set");
  expect(JSON.stringify(passwordSet.metadata)).not.toContain("new-password-456");

  const invitationList = await listAuditLog({ action: "user.sign_in_invitation.sent" });
  expect(invitationList.status).toBe(200);
  expect(invitationList.body.items).toHaveLength(1);
  expect(invitationList.body.items[0]).toMatchObject({
    action: "user.sign_in_invitation.sent",
    target_user_id: null,
    metadata: {
      source: "internal.send_sign_in_invitation",
    },
  });
  expect(JSON.stringify(invitationList.body.items[0].metadata)).not.toContain("invitee-audit@example.com");
});

it("does not audit client self-service password reset emails", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  const signUp = await Auth.Password.signUpWithEmail();
  await Auth.signOut();

  const sendReset = await niceBackendFetch("/api/v1/auth/password/send-reset-code", {
    accessType: "client",
    method: "POST",
    body: {
      email: signUp.email,
      callback_url: "http://localhost:12345/some-callback-url",
    },
  });
  expect(sendReset.status).toBe(200);

  const listRes = await listAuditLog({ action: "user.password_reset.sent" });
  expect(listRes.status).toBe(200);
  expect(listRes.body.items).toEqual([]);
});

it("records project API key create, update, and revoke without persisting secrets", async ({ expect }) => {
  // createAndSwitch already mints a project key set for test auth — create a
  // second set with a distinct description so we can assert on that event.
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });

  const created = await InternalApiKey.create(undefined, {
    description: "Audited project key",
    has_publishable_client_key: true,
    has_secret_server_key: true,
    has_super_secret_admin_key: false,
  });
  const apiKeyId = created.createApiKeyResponse.body.id as string;
  const secretServerKey = created.createApiKeyResponse.body.secret_server_key as string;
  expect(typeof secretServerKey).toBe("string");

  const rename = await niceBackendFetch(`/api/v1/internal/api-keys/${apiKeyId}`, {
    accessType: "admin",
    method: "PATCH",
    body: {
      description: "Renamed audited project key",
    },
  });
  expect(rename.status).toBe(200);

  const revoke = await niceBackendFetch(`/api/v1/internal/api-keys/${apiKeyId}`, {
    accessType: "admin",
    method: "PATCH",
    body: {
      revoked: true,
    },
  });
  expect(revoke.status).toBe(200);

  const createdList = await listAuditLog({ action: "project_api_key.created" });
  expect(createdList.status).toBe(200);
  const createdEvent = createdList.body.items.find((item: { metadata?: { changes?: { description?: { after?: string } } } }) => (
    item.metadata?.changes?.description?.after === "Audited project key"
  ));
  expect(createdEvent).toMatchObject({
    action: "project_api_key.created",
    target_user_id: null,
    metadata: {
      source: "internal.api_keys.create",
      changed_paths: expect.arrayContaining([
        "api_key_id",
        "description",
        "has_publishable_client_key",
        "has_secret_server_key",
      ]),
      changes: {
        description: { before: null, after: "Audited project key" },
        has_publishable_client_key: { before: null, after: true },
        has_secret_server_key: { before: null, after: true },
        has_super_secret_admin_key: { before: null, after: false },
      },
    },
  });
  expect(JSON.stringify(createdEvent.metadata)).not.toContain(secretServerKey);
  expect(JSON.stringify(createdEvent.metadata)).not.toContain("pck_");
  expect(JSON.stringify(createdEvent.metadata)).not.toContain("ssk_");

  const updatedList = await listAuditLog({ action: "project_api_key.updated" });
  expect(updatedList.status).toBe(200);
  expect(updatedList.body.items).toHaveLength(1);
  expect(updatedList.body.items[0]).toMatchObject({
    action: "project_api_key.updated",
    metadata: {
      source: "internal.api_keys.update",
      api_key_id: apiKeyId,
      changed_paths: ["description"],
      changes: {
        description: {
          before: "Audited project key",
          after: "Renamed audited project key",
        },
      },
    },
  });

  const revokedList = await listAuditLog({ action: "project_api_key.revoked" });
  expect(revokedList.status).toBe(200);
  expect(revokedList.body.items).toHaveLength(1);
  expect(revokedList.body.items[0]).toMatchObject({
    action: "project_api_key.revoked",
    metadata: {
      source: "internal.api_keys.update",
      api_key_id: apiKeyId,
      description: "Renamed audited project key",
    },
  });
});
