import { describe } from "vitest";
import { it } from "../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../backend-helpers";

describe("restricted user status", () => {
  describe("with requireEmailVerification enabled", () => {
    it("should mark a user with unverified email as restricted", async ({ expect }) => {
      // Create a project with email verification required
      await Project.createAndSwitch({
        config: {
          credential_enabled: true,
        },
      });
      await Project.updateConfig({
        onboarding: { requireEmailVerification: true },
      });

      // Create a user with an unverified email (via server, not via auth flow to ensure unverified)
      const createResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          primary_email: "test-restricted@example.com",
          primary_email_auth_enabled: true,
        },
      });

      expect(createResponse.status).toBe(201);
      expect(createResponse.body.primary_email_verified).toBe(false);
      expect(createResponse.body.is_restricted).toBe(true);
      expect(createResponse.body.restricted_reason).toEqual({ type: "email_not_verified" });
    });

    it("should mark a user with verified email as not restricted", async ({ expect }) => {
      // Create a project with email verification required
      await Project.createAndSwitch({
        config: {
          magic_link_enabled: true,
        },
      });
      await Project.updateConfig({
        onboarding: { requireEmailVerification: true },
      });

      // Sign in with OTP (which verifies email as part of the flow)
      await Auth.Otp.signIn();

      const response = await niceBackendFetch("/api/v1/users/me", {
        accessType: "server",
      });

      expect(response.status).toBe(200);
      expect(response.body.primary_email_verified).toBe(true);
      expect(response.body.is_restricted).toBe(false);
      expect(response.body.restricted_reason).toBe(null);
    });

    it("should filter out restricted users by default in list", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          magic_link_enabled: true,
        },
      });
      await Project.updateConfig({
        onboarding: { requireEmailVerification: true },
      });

      // Create a verified user (OTP sign in verifies email)
      await Auth.Otp.signIn();
      const verifiedUserId = (await niceBackendFetch("/api/v1/users/me", {
        accessType: "server",
      })).body.id;

      // Create an unverified user
      const unverifiedUserResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          primary_email: "unverified@example.com",
          primary_email_auth_enabled: true,
        },
      });
      const unverifiedUserId = unverifiedUserResponse.body.id;

      // List users without include_restricted - should only get verified user (restricted users are filtered out)
      const listResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
      });

      expect(listResponse.status).toBe(200);
      const userIds = listResponse.body.items.map((u: any) => u.id);
      expect(userIds).toContain(verifiedUserId);
      expect(userIds).not.toContain(unverifiedUserId);
    });

    it("should include restricted users when include_restricted is true", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          magic_link_enabled: true,
        },
      });
      await Project.updateConfig({
        onboarding: { requireEmailVerification: true },
      });

      // Create a verified user
      await Auth.Otp.signIn();
      const verifiedUserId = (await niceBackendFetch("/api/v1/users/me", {
        accessType: "server",
      })).body.id;

      // Create an unverified user
      const unverifiedUserResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          primary_email: "unverified@example.com",
          primary_email_auth_enabled: true,
        },
      });
      const unverifiedUserId = unverifiedUserResponse.body.id;

      // List users with include_restricted - should get both
      const listResponse = await niceBackendFetch("/api/v1/users?include_restricted=true", {
        accessType: "server",
      });

      expect(listResponse.status).toBe(200);
      const userIds = listResponse.body.items.map((u: any) => u.id);
      expect(userIds).toContain(verifiedUserId);
      expect(userIds).toContain(unverifiedUserId);
    });

    it("should include restricted users when include_anonymous is true", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          magic_link_enabled: true,
        },
      });
      await Project.updateConfig({
        onboarding: { requireEmailVerification: true },
      });

      // Create an unverified user
      const unverifiedUserResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          primary_email: "unverified@example.com",
          primary_email_auth_enabled: true,
        },
      });
      const unverifiedUserId = unverifiedUserResponse.body.id;

      // List users with include_anonymous - should include restricted users too
      const listResponse = await niceBackendFetch("/api/v1/users?include_anonymous=true", {
        accessType: "server",
      });

      expect(listResponse.status).toBe(200);
      const userIds = listResponse.body.items.map((u: any) => u.id);
      expect(userIds).toContain(unverifiedUserId);
    });
  });

  describe("with requireEmailVerification disabled", () => {
    it("should not mark a user with unverified email as restricted", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          credential_enabled: true,
        },
      });
      await Project.updateConfig({
        onboarding: { requireEmailVerification: false },
      });

      // Create a user with an unverified email
      const createResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          primary_email: "test@example.com",
          primary_email_auth_enabled: true,
        },
      });

      expect(createResponse.status).toBe(201);
      expect(createResponse.body.primary_email_verified).toBe(false);
      expect(createResponse.body.is_restricted).toBe(false);
      expect(createResponse.body.restricted_reason).toBe(null);
    });

    it("should include all non-anonymous users in list", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          magic_link_enabled: true,
        },
      });
      await Project.updateConfig({
        onboarding: { requireEmailVerification: false },
      });

      // Create an unverified user
      const unverifiedUserResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          primary_email: "unverified@example.com",
          primary_email_auth_enabled: true,
        },
      });
      const unverifiedUserId = unverifiedUserResponse.body.id;

      // List users without include_restricted flag - should still get the user since is_restricted is false
      const listResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
      });

      expect(listResponse.status).toBe(200);
      const userIds = listResponse.body.items.map((u: any) => u.id);
      expect(userIds).toContain(unverifiedUserId);
    });
  });

  describe("anonymous users", () => {
    it("should mark anonymous users as restricted with reason 'anonymous'", async ({ expect }) => {
      await Project.createAndSwitch();
      await Project.updateConfig({
        onboarding: { requireEmailVerification: true },
      });

      // Create an anonymous user
      const createResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          is_anonymous: true,
        },
      });

      expect(createResponse.status).toBe(201);
      expect(createResponse.body.is_anonymous).toBe(true);
      expect(createResponse.body.is_restricted).toBe(true);
      expect(createResponse.body.restricted_reason).toEqual({ type: "anonymous" });
    });
  });

  describe("project configuration", () => {
    it("should be able to enable require_email_verification via config override", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          magic_link_enabled: true,
        },
      });

      // Update the project config to enable email verification requirement
      await Project.updateConfig({
        onboarding: { requireEmailVerification: true },
      });

      // Verify the config was applied by checking that a new unverified user is restricted
      const createResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          primary_email: "test@example.com",
          primary_email_auth_enabled: true,
        },
      });

      expect(createResponse.status).toBe(201);
      expect(createResponse.body.is_restricted).toBe(true);
      expect(createResponse.body.restricted_reason).toEqual({ type: "email_not_verified" });
    });
  });

  describe("restricted_by_admin filtering in list users", () => {
    it("should filter out users with restricted_by_admin=true by default in list", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          credential_enabled: true,
        },
      });

      // Create a normal user (not restricted by admin)
      const normalUserResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          primary_email: "normal@example.com",
          primary_email_auth_enabled: true,
        },
      });
      const normalUserId = normalUserResponse.body.id;

      // Create a user restricted by admin
      const restrictedUserResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          primary_email: "restricted-by-admin@example.com",
          primary_email_auth_enabled: true,
          restricted_by_admin: true,
          restricted_by_admin_reason: "Sign-up rule triggered",
        },
      });
      const restrictedUserId = restrictedUserResponse.body.id;

      // Verify the restricted user has is_restricted=true with correct reason
      expect(restrictedUserResponse.body.restricted_by_admin).toBe(true);
      expect(restrictedUserResponse.body.is_restricted).toBe(true);
      expect(restrictedUserResponse.body.restricted_reason).toEqual({ type: "restricted_by_administrator" });

      // List users without include_restricted - should only get normal user
      const listResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
      });

      expect(listResponse.status).toBe(200);
      const userIds = listResponse.body.items.map((u: any) => u.id);
      expect(userIds).toContain(normalUserId);
      expect(userIds).not.toContain(restrictedUserId);
    });

    it("should include users with restricted_by_admin=true when include_restricted=true", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          credential_enabled: true,
        },
      });

      // Create a normal user
      const normalUserResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          primary_email: "normal@example.com",
          primary_email_auth_enabled: true,
        },
      });
      const normalUserId = normalUserResponse.body.id;

      // Create a user restricted by admin
      const restrictedUserResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          primary_email: "restricted-by-admin@example.com",
          primary_email_auth_enabled: true,
          restricted_by_admin: true,
        },
      });
      const restrictedUserId = restrictedUserResponse.body.id;

      // List users with include_restricted - should get both
      const listResponse = await niceBackendFetch("/api/v1/users?include_restricted=true", {
        accessType: "server",
      });

      expect(listResponse.status).toBe(200);
      const userIds = listResponse.body.items.map((u: any) => u.id);
      expect(userIds).toContain(normalUserId);
      expect(userIds).toContain(restrictedUserId);
    });

    it("should include users with restricted_by_admin=true when include_anonymous=true", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          credential_enabled: true,
        },
      });

      // Create a user restricted by admin
      const restrictedUserResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          primary_email: "restricted-by-admin@example.com",
          primary_email_auth_enabled: true,
          restricted_by_admin: true,
        },
      });
      const restrictedUserId = restrictedUserResponse.body.id;

      // List users with include_anonymous - should include restricted users too
      const listResponse = await niceBackendFetch("/api/v1/users?include_anonymous=true", {
        accessType: "server",
      });

      expect(listResponse.status).toBe(200);
      const userIds = listResponse.body.items.map((u: any) => u.id);
      expect(userIds).toContain(restrictedUserId);
    });

    it("should filter out restricted_by_admin users even when requireEmailVerification is disabled", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          credential_enabled: true,
        },
      });
      // Explicitly disable email verification requirement
      await Project.updateConfig({
        onboarding: { requireEmailVerification: false },
      });

      // Create a user restricted by admin (but with unverified email)
      const restrictedUserResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          primary_email: "restricted-by-admin@example.com",
          primary_email_auth_enabled: true,
          restricted_by_admin: true,
        },
      });
      const restrictedUserId = restrictedUserResponse.body.id;

      // User should have is_restricted=true due to admin restriction, not email verification
      expect(restrictedUserResponse.body.restricted_by_admin).toBe(true);
      expect(restrictedUserResponse.body.is_restricted).toBe(true);
      expect(restrictedUserResponse.body.restricted_reason).toEqual({ type: "restricted_by_administrator" });

      // List users without include_restricted - should NOT contain the admin-restricted user
      const listResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
      });

      expect(listResponse.status).toBe(200);
      const userIds = listResponse.body.items.map((u: any) => u.id);
      expect(userIds).not.toContain(restrictedUserId);
    });

    it("should filter both email-unverified and admin-restricted users independently", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          credential_enabled: true,
        },
      });
      // Enable email verification requirement
      await Project.updateConfig({
        onboarding: { requireEmailVerification: true },
      });

      // Create a user with verified email but restricted by admin
      const adminRestrictedResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          primary_email: "admin-restricted@example.com",
          primary_email_auth_enabled: true,
          primary_email_verified: true,
          restricted_by_admin: true,
        },
      });
      const adminRestrictedUserId = adminRestrictedResponse.body.id;

      // Create a user with unverified email but NOT restricted by admin
      const emailRestrictedResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          primary_email: "unverified@example.com",
          primary_email_auth_enabled: true,
          primary_email_verified: false,
        },
      });
      const emailRestrictedUserId = emailRestrictedResponse.body.id;

      // Create a fully verified, non-restricted user
      const normalUserResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          primary_email: "normal@example.com",
          primary_email_auth_enabled: true,
          primary_email_verified: true,
        },
      });
      const normalUserId = normalUserResponse.body.id;

      // Verify admin-restricted user has correct restriction reason (admin takes precedence over email)
      expect(adminRestrictedResponse.body.is_restricted).toBe(true);
      expect(adminRestrictedResponse.body.restricted_reason).toEqual({ type: "restricted_by_administrator" });

      // Verify email-restricted user has correct restriction reason
      expect(emailRestrictedResponse.body.is_restricted).toBe(true);
      expect(emailRestrictedResponse.body.restricted_reason).toEqual({ type: "email_not_verified" });

      // List users without include_restricted - should only get normal user
      const listResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
      });

      expect(listResponse.status).toBe(200);
      const userIds = listResponse.body.items.map((u: any) => u.id);
      expect(userIds).toContain(normalUserId);
      expect(userIds).not.toContain(adminRestrictedUserId);
      expect(userIds).not.toContain(emailRestrictedUserId);
    });

    it("should unrestrict a user by setting restricted_by_admin to false", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          credential_enabled: true,
        },
      });

      // Create a user restricted by admin
      const restrictedUserResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          primary_email: "restricted@example.com",
          primary_email_auth_enabled: true,
          restricted_by_admin: true,
        },
      });
      const restrictedUserId = restrictedUserResponse.body.id;

      // Verify user is restricted
      expect(restrictedUserResponse.body.is_restricted).toBe(true);

      // Update user to unrestrict
      const updateResponse = await niceBackendFetch(`/api/v1/users/${restrictedUserId}`, {
        accessType: "server",
        method: "PATCH",
        body: {
          restricted_by_admin: false,
        },
      });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.restricted_by_admin).toBe(false);
      expect(updateResponse.body.is_restricted).toBe(false);

      // List users without include_restricted - should now contain the unrestricted user
      const listResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
      });

      expect(listResponse.status).toBe(200);
      const userIds = listResponse.body.items.map((u: any) => u.id);
      expect(userIds).toContain(restrictedUserId);
    });
  });
});

