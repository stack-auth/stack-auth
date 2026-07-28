import { describe, expect, it } from "vitest";
import { Result } from "@hexclave/shared/dist/utils/results";
import { _HexclaveServerAppImplIncomplete } from "./server-app-impl";

describe("server app MCP user scope wiring", () => {
  it("passes granted scopes through getUser and narrows authority reads", async () => {
    // Constructing the implementation directly would initialize a live backend interface. An object
    // with its prototype and only the caches this read path consumes lets the real user builder run
    // while keeping this test independent of a backend.
    const app = Object.create(_HexclaveServerAppImplIncomplete.prototype);
    Reflect.set(app, "_interface", {
      createSession: () => ({}),
    });
    const crud = {
      id: "user-1",
      display_name: "Test User",
      primary_email: null,
      primary_email_verified: false,
      profile_image_url: null,
      signed_up_at_millis: 0,
      has_password: false,
      auth_with_email: true,
      otp_auth_enabled: false,
      passkey_auth_enabled: false,
      requires_totp_mfa: false,
      is_anonymous: false,
      is_restricted: false,
      restricted_reason: null,
      selected_team: null,
      client_metadata: {},
      client_read_only_metadata: {},
      server_metadata: {},
      last_active_at_millis: 0,
      restricted_by_admin: false,
      restricted_by_admin_reason: null,
      restricted_by_admin_private_details: null,
      country_code: null,
      risk_scores: { sign_up: { bot: 0, free_trial_abuse: 0 } },
      oauth_providers: [],
    };
    Reflect.set(app, "_serverUserCache", {
      getOrWait: async () => Result.ok(crud),
    });
    Reflect.set(app, "_serverUserProjectPermissionsCache", {
      getOrWait: async () => Result.ok([{ id: "read_docs" }, { id: "write_docs" }]),
    });

    const authInfo = {
      token: "test-token",
      clientId: "test-client",
      scopes: ["perm:read_docs"],
      extra: { userId: "user-1" },
    };
    const user = await app.getUser({
      from: "mcp",
      authInfo,
    });

    expect(await user.listPermissions()).toEqual([{ id: "read_docs" }]);
    expect(await user.hasPermission("read_docs")).toBe(true);
    expect(await user.hasPermission("write_docs")).toBe(false);

    Reflect.deleteProperty(authInfo, "scopes");
    const userWithoutScopes = await app.getUser({ from: "mcp", authInfo });
    expect(await userWithoutScopes.hasPermission("read_docs")).toBe(false);

    authInfo.scopes = ["team_perm:read_docs"];
    const teamScopedUser = await app.getUser({ from: "mcp", authInfo });
    expect(await teamScopedUser.listPermissions()).toEqual([]);
  });
});
