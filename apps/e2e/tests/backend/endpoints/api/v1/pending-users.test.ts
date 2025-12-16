import { describe } from "vitest";
import { it } from "../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../backend-helpers";

describe("pending user status", () => {
  describe("with requireEmailVerification enabled", () => {
    it("should mark a user with unverified email as pending", async ({ expect }) => {
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
          primary_email: "test-pending@example.com",
          primary_email_auth_enabled: true,
        },
      });

      expect(createResponse.status).toBe(201);
      expect(createResponse.body.primary_email_verified).toBe(false);
      expect(createResponse.body.is_pending).toBe(true);
      expect(createResponse.body.pending_reason).toBe("email_not_verified");
    });

    it("should mark a user with verified email as not pending", async ({ expect }) => {
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
      expect(response.body.is_pending).toBe(false);
      expect(response.body.pending_reason).toBe(null);
    });

    it("should filter out pending users by default in list", async ({ expect }) => {
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

      // List users without include_pending - should only get verified user
      const listResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
      });

      expect(listResponse.status).toBe(200);
      const userIds = listResponse.body.items.map((u: any) => u.id);
      expect(userIds).toContain(verifiedUserId);
      expect(userIds).not.toContain(unverifiedUserId);
    });

    it("should include pending users when include_pending is true", async ({ expect }) => {
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

      // List users with include_pending - should get both
      const listResponse = await niceBackendFetch("/api/v1/users?include_pending=true", {
        accessType: "server",
      });

      expect(listResponse.status).toBe(200);
      const userIds = listResponse.body.items.map((u: any) => u.id);
      expect(userIds).toContain(verifiedUserId);
      expect(userIds).toContain(unverifiedUserId);
    });

    it("should include pending users when include_anonymous is true", async ({ expect }) => {
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

      // List users with include_anonymous - should include pending users too
      const listResponse = await niceBackendFetch("/api/v1/users?include_anonymous=true", {
        accessType: "server",
      });

      expect(listResponse.status).toBe(200);
      const userIds = listResponse.body.items.map((u: any) => u.id);
      expect(userIds).toContain(unverifiedUserId);
    });
  });

  describe("with requireEmailVerification disabled", () => {
    it("should not mark a user with unverified email as pending", async ({ expect }) => {
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
      expect(createResponse.body.is_pending).toBe(false);
      expect(createResponse.body.pending_reason).toBe(null);
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

      // List users without include_pending - should still get the user since is_pending is false
      const listResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
      });

      expect(listResponse.status).toBe(200);
      const userIds = listResponse.body.items.map((u: any) => u.id);
      expect(userIds).toContain(unverifiedUserId);
    });
  });

  describe("anonymous users", () => {
    it("should not mark anonymous users as pending", async ({ expect }) => {
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
      expect(createResponse.body.is_pending).toBe(false);
      expect(createResponse.body.pending_reason).toBe(null);
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

      // Verify the config was applied by checking that a new unverified user is pending
      const createResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          primary_email: "test@example.com",
          primary_email_auth_enabled: true,
        },
      });

      expect(createResponse.status).toBe(201);
      expect(createResponse.body.is_pending).toBe(true);
      expect(createResponse.body.pending_reason).toBe("email_not_verified");
    });
  });
});

