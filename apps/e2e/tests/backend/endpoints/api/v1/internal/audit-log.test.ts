import { it } from "../../../../../helpers";
import { Auth, InternalApiKey, Payments, Project, bumpEmailAddress, niceBackendFetch } from "../../../../backend-helpers";

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

/** Project.createAndSwitch mints project API keys, which now write project_api_key.created. */
function withoutProjectBootstrapEvents(items: Array<{ action: string }>) {
  return items.filter((item) => item.action !== "project_api_key.created");
}

it("lists admin audit events without requiring Compliance app", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });

  const res = await listAuditLog();
  expect(res.status).toBe(200);
  expect(withoutProjectBootstrapEvents(res.body.items)).toEqual([]);
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

  const listRes = await listAuditLog({ action: "impersonation.started" });
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

  const listRes = await listAuditLog({ action: "impersonation.started" });
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
  expect(withoutProjectBootstrapEvents(listRes.body.items)).toEqual([]);
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

it("records config source unlink with previous GitHub identity", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });

  await Project.pushConfig({}, {
    type: "pushed-from-github",
    owner: "audit-org",
    repo: "audit-repo",
    branch: "main",
    commit_hash: "abc123def456",
    config_file_path: "hexclave.config.ts",
  });

  await Project.unlinkConfigSource();

  const listRes = await listAuditLog({ action: "config_source.unlinked" });
  expect(listRes.status).toBe(200);
  expect(listRes.body.items).toHaveLength(1);
  expect(listRes.body.items[0]).toMatchObject({
    action: "config_source.unlinked",
    target_user_id: null,
    metadata: {
      source: "config.source.delete",
      changed_paths: expect.arrayContaining([
        "type",
        "owner",
        "repo",
        "branch",
        "config_file_path",
      ]),
      changes: {
        type: {
          before: "pushed-from-github",
          after: "unlinked",
        },
        owner: {
          before: "audit-org",
          after: null,
        },
        repo: {
          before: "audit-repo",
          after: null,
        },
      },
    },
  });
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

  // Whole-provider enable collapses to one summary row (same shape as disable).
  const linkedinEnable = listRes.body.items.find((item: { metadata?: { changed_paths?: string[] } }) => (
    item.metadata?.changed_paths?.includes("auth.oauth.providers.linkedin")
  ));
  expect(linkedinEnable).toMatchObject({
    action: "project_settings.updated",
    metadata: {
      changed_paths: ["auth.oauth.providers.linkedin"],
      changes: {
        "auth.oauth.providers.linkedin": {
          before: null,
          after: "linkedin",
        },
      },
    },
  });
  expect(JSON.stringify(linkedinEnable.metadata)).not.toContain("linkedin-client-secret");
  expect(JSON.stringify(linkedinEnable.metadata)).not.toContain("facebookConfigId");

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

it("audits shared→standard oauth key switch with only real field diffs", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });

  await Project.updateConfig({
    "auth.oauth.providers.github": {
      type: "github",
      isShared: true,
      allowSignIn: true,
      allowConnectedAccounts: true,
    },
  });

  await Project.updateConfig({
    "auth.oauth.providers.github": {
      type: "github",
      isShared: false,
      clientId: "gh-client-id",
      clientSecret: "gh-client-secret",
      customCallbackUrl: "http://localhost:8102/api/v1/auth/oauth/callback/github",
      // Unchanged flags — must not appear as Yes→Yes in the audit.
      allowSignIn: true,
      allowConnectedAccounts: true,
      facebookConfigId: "",
      microsoftTenantId: "",
    },
  });

  const listRes = await listAuditLog({ action: "project_settings.updated" });
  expect(listRes.status).toBe(200);
  const keySwitch = listRes.body.items.find((item: { metadata?: { changes?: { "auth.oauth.providers.github.isShared"?: unknown } } }) => (
    item.metadata?.changes?.["auth.oauth.providers.github.isShared"] != null
  ));
  expect(keySwitch).toBeDefined();
  expect(keySwitch.metadata.changed_paths).toEqual(expect.arrayContaining([
    "auth.oauth.providers.github.isShared",
    "auth.oauth.providers.github.clientId",
    "auth.oauth.providers.github.clientSecret",
    "auth.oauth.providers.github.customCallbackUrl",
  ]));
  expect(keySwitch.metadata.changed_paths).not.toContain("auth.oauth.providers.github.allowSignIn");
  expect(keySwitch.metadata.changed_paths).not.toContain("auth.oauth.providers.github.allowConnectedAccounts");
  expect(keySwitch.metadata.changed_paths).not.toContain("auth.oauth.providers.github.facebookConfigId");
  expect(keySwitch.metadata.changes?.["auth.oauth.providers.github.isShared"]).toMatchObject({
    before: true,
    after: false,
  });
  expect(keySwitch.metadata.changes?.["auth.oauth.providers.github.allowSignIn"]).toBeUndefined();
  expect(JSON.stringify(keySwitch.metadata)).not.toContain("gh-client-secret");
});

it("does not audit end-user password signup (programmatic user create)", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Password.signUpWithEmail();

  const listRes = await listAuditLog();
  expect(listRes.status).toBe(200);
  expect(withoutProjectBootstrapEvents(listRes.body.items)).toEqual([]);
  expect(listRes.body.items.some((item: { action: string }) => item.action === "user.created")).toBe(false);
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

it("records Teams admin mutations (create/update/delete, membership, permissions, checkout, item quantity) and skips client self-service", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    },
  });
  await Payments.setup();
  await Project.updateConfig({
    teams: {
      allowClientTeamCreation: true,
    },
    payments: {
      testMode: true,
      items: {
        "team-credits": {
          displayName: "Team Credits",
          customerType: "team",
        },
      },
      products: {
        "team-product": {
          displayName: "Team Product",
          customerType: "team",
          serverOnly: false,
          stackable: true,
          prices: {
            monthly: {
              USD: "1000",
              interval: [1, "month"],
            },
          },
          includedItems: {},
        },
      },
    },
  });

  const { userId: memberUserId } = await Auth.Password.signUpWithEmail();
  await Auth.signOut();

  const createTeam = await niceBackendFetch("/api/v1/teams", {
    accessType: "admin",
    method: "POST",
    body: {
      display_name: "Audited Team",
      client_metadata: { plan: "starter" },
      client_read_only_metadata: { seat_limit: 5 },
      server_metadata: { internal_note: "vip" },
    },
  });
  expect(createTeam.status).toBe(201);
  const teamId = createTeam.body.id as string;

  const rename = await niceBackendFetch(`/api/v1/teams/${teamId}`, {
    accessType: "admin",
    method: "PATCH",
    body: {
      display_name: "Renamed Audited Team",
      client_metadata: { plan: "pro" },
      client_read_only_metadata: { seat_limit: 10 },
      server_metadata: { internal_note: "vip-renewed" },
    },
  });
  expect(rename.status).toBe(200);

  const addMember = await niceBackendFetch(`/api/v1/team-memberships/${teamId}/${memberUserId}`, {
    accessType: "admin",
    method: "POST",
    body: {},
  });
  expect(addMember.status).toBe(201);

  const grantPermission = await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${memberUserId}/$update_team`, {
    accessType: "admin",
    method: "POST",
    body: {},
  });
  expect(grantPermission.status).toBe(201);

  const revokePermission = await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${memberUserId}/$update_team`, {
    accessType: "admin",
    method: "DELETE",
  });
  expect(revokePermission.status).toBe(200);

  const quantityChange = await niceBackendFetch(`/api/v1/payments/items/team/${teamId}/team-credits/update-quantity?allow_negative=false`, {
    accessType: "admin",
    method: "POST",
    body: {
      delta: 7,
      description: "manual team grant",
    },
  });
  expect(quantityChange.status).toBe(200);

  const checkout = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    accessType: "admin",
    method: "POST",
    body: {
      customer_type: "team",
      customer_id: teamId,
      product_id: "team-product",
    },
  });
  expect(checkout.status).toBe(200);
  const checkoutUrl = checkout.body.url as string;
  expect(typeof checkoutUrl).toBe("string");

  const removeMember = await niceBackendFetch(`/api/v1/team-memberships/${teamId}/${memberUserId}`, {
    accessType: "admin",
    method: "DELETE",
  });
  expect(removeMember.status).toBe(200);

  const deleteTeam = await niceBackendFetch(`/api/v1/teams/${teamId}`, {
    accessType: "admin",
    method: "DELETE",
  });
  expect(deleteTeam.status).toBe(200);

  // Client self-service team create must not write admin audit events.
  await bumpEmailAddress();
  await Auth.Password.signUpWithEmail();
  const clientCreate = await niceBackendFetch("/api/v1/teams", {
    accessType: "client",
    method: "POST",
    body: {
      display_name: "Client Self-Service Team",
      creator_user_id: "me",
    },
  });
  expect(clientCreate.status).toBe(201);
  const clientTeamId = clientCreate.body.id as string;

  const createdList = await listAuditLog({ action: "team.created" });
  expect(createdList.status).toBe(200);
  expect(createdList.body.items).toHaveLength(1);
  expect(createdList.body.items[0]).toMatchObject({
    action: "team.created",
    target_user_id: null,
    metadata: {
      source: "teams.create",
      changed_paths: expect.arrayContaining([
        "team_id",
        "display_name",
        "client_metadata.plan",
        "client_read_only_metadata.seat_limit",
        "server_metadata.internal_note",
      ]),
      changes: {
        display_name: { before: null, after: "Audited Team" },
        "client_metadata.plan": { before: null, after: "starter" },
        "client_read_only_metadata.seat_limit": { before: null, after: 5 },
        "server_metadata.internal_note": { before: null, after: "vip" },
      },
    },
  });
  expect(createdList.body.items[0].metadata.changes.team_id.after).toBe(teamId);
  expect(JSON.stringify(createdList.body.items)).not.toContain("Client Self-Service Team");
  expect(JSON.stringify(createdList.body.items)).not.toContain(clientTeamId);

  const updatedList = await listAuditLog({ action: "team.updated" });
  expect(updatedList.status).toBe(200);
  expect(updatedList.body.items).toHaveLength(1);
  expect(updatedList.body.items[0]).toMatchObject({
    action: "team.updated",
    metadata: {
      source: "teams.update",
      team_id: teamId,
      changed_paths: expect.arrayContaining([
        "display_name",
        "client_metadata.plan",
        "client_read_only_metadata.seat_limit",
        "server_metadata.internal_note",
      ]),
      changes: {
        display_name: { before: "Audited Team", after: "Renamed Audited Team" },
        "client_metadata.plan": { before: "starter", after: "pro" },
        "client_read_only_metadata.seat_limit": { before: 5, after: 10 },
        "server_metadata.internal_note": { before: "vip", after: "vip-renewed" },
      },
    },
  });

  const membershipCreated = await listAuditLog({ action: "team_membership.created" });
  expect(membershipCreated.status).toBe(200);
  expect(membershipCreated.body.items).toHaveLength(1);
  expect(membershipCreated.body.items[0]).toMatchObject({
    action: "team_membership.created",
    target_user_id: memberUserId,
    metadata: {
      source: "team_memberships.create",
      changes: {
        team_id: { before: null, after: teamId },
        user_id: { before: null, after: memberUserId },
      },
    },
  });

  const membershipDeleted = await listAuditLog({ action: "team_membership.deleted" });
  expect(membershipDeleted.status).toBe(200);
  expect(membershipDeleted.body.items).toHaveLength(1);
  expect(membershipDeleted.body.items[0]).toMatchObject({
    action: "team_membership.deleted",
    target_user_id: memberUserId,
    metadata: {
      source: "team_memberships.delete",
      team_id: teamId,
      user_id: memberUserId,
    },
  });

  const permissionGranted = await listAuditLog({ action: "team_permission.granted" });
  expect(permissionGranted.status).toBe(200);
  expect(permissionGranted.body.items).toHaveLength(1);
  expect(permissionGranted.body.items[0]).toMatchObject({
    action: "team_permission.granted",
    target_user_id: memberUserId,
    metadata: {
      source: "team_permissions.create",
      changes: {
        team_id: { before: null, after: teamId },
        user_id: { before: null, after: memberUserId },
        permission_id: { before: null, after: "$update_team" },
      },
    },
  });

  const permissionRevoked = await listAuditLog({ action: "team_permission.revoked" });
  expect(permissionRevoked.status).toBe(200);
  expect(permissionRevoked.body.items).toHaveLength(1);
  expect(permissionRevoked.body.items[0]).toMatchObject({
    action: "team_permission.revoked",
    target_user_id: memberUserId,
    metadata: {
      source: "team_permissions.delete",
      team_id: teamId,
      user_id: memberUserId,
      permission_id: "$update_team",
    },
  });

  const itemQuantity = await listAuditLog({ action: "team.item_quantity.changed" });
  expect(itemQuantity.status).toBe(200);
  expect(itemQuantity.body.items).toHaveLength(1);
  expect(itemQuantity.body.items[0]).toMatchObject({
    action: "team.item_quantity.changed",
    metadata: {
      source: "payments.items.update_quantity",
      team_id: teamId,
      item_id: "team-credits",
      delta: 7,
      allow_negative: false,
      description: "manual team grant",
      changes: {
        quantity: { before: 0, after: 7 },
      },
    },
  });

  const checkoutList = await listAuditLog({ action: "team.checkout.created" });
  expect(checkoutList.status).toBe(200);
  expect(checkoutList.body.items).toHaveLength(1);
  expect(checkoutList.body.items[0]).toMatchObject({
    action: "team.checkout.created",
    metadata: {
      source: "payments.create_purchase_url",
      changes: {
        team_id: { before: null, after: teamId },
        product_id: { before: null, after: "team-product" },
        has_product_inline: { before: null, after: false },
      },
    },
  });
  expect(JSON.stringify(checkoutList.body.items[0].metadata)).not.toContain(checkoutUrl);
  expect(JSON.stringify(checkoutList.body.items[0].metadata)).not.toContain("/purchase/");

  const deletedList = await listAuditLog({ action: "team.deleted" });
  expect(deletedList.status).toBe(200);
  expect(deletedList.body.items).toHaveLength(1);
  expect(deletedList.body.items[0]).toMatchObject({
    action: "team.deleted",
    metadata: {
      source: "teams.delete",
      team_id: teamId,
      display_name: "Renamed Audited Team",
    },
  });
});
