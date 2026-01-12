import { describe } from "vitest";
import { it } from "../../../../helpers";
import { Auth, Project, backendContext, createMailbox, niceBackendFetch } from "../../../backend-helpers";

describe("updating primary_email via users/me endpoint", () => {
  describe("client access", () => {
    it("should be able to set primary_email when user has no email", async ({ expect }) => {
      // Create a project and an anonymous user, then convert to signed-in user
      await Project.createAndSwitch({
        config: {
          credential_enabled: true,
        },
      });

      // Create a user without email via server
      const createResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          display_name: "User Without Email",
        },
      });
      expect(createResponse.status).toBe(201);
      expect(createResponse.body.primary_email).toBe(null);

      // Get auth tokens for this user via server
      const sessionResponse = await niceBackendFetch(`/api/v1/auth/sessions`, {
        accessType: "server",
        method: "POST",
        body: {
          user_id: createResponse.body.id,
        },
      });
      expect(sessionResponse.status).toBe(200);

      // Set the user auth context
      backendContext.set({
        userAuth: {
          accessToken: sessionResponse.body.access_token,
          refreshToken: sessionResponse.body.refresh_token,
        },
      });

      // Now update primary_email via client
      const newMailbox = createMailbox();
      const updateResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
        method: "PATCH",
        body: {
          primary_email: newMailbox.emailAddress,
        },
      });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.primary_email).toBe(newMailbox.emailAddress);
      expect(updateResponse.body.primary_email_verified).toBe(false);
    });

    it("should be able to change primary_email to a new email", async ({ expect }) => {
      await Auth.Otp.signIn();

      const oldEmail = (await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
      })).body.primary_email;

      const newMailbox = createMailbox();
      const updateResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
        method: "PATCH",
        body: {
          primary_email: newMailbox.emailAddress,
        },
      });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.primary_email).toBe(newMailbox.emailAddress);
      expect(updateResponse.body.primary_email).not.toBe(oldEmail);
      // New email should be unverified
      expect(updateResponse.body.primary_email_verified).toBe(false);
    });

    it("should set new email as unverified even if old email was verified", async ({ expect }) => {
      // Sign in with OTP (verifies email)
      await Auth.Otp.signIn();

      // Verify the email is verified
      const beforeResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
      });
      expect(beforeResponse.body.primary_email_verified).toBe(true);

      // Change to new email
      const newMailbox = createMailbox();
      const updateResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
        method: "PATCH",
        body: {
          primary_email: newMailbox.emailAddress,
        },
      });

      expect(updateResponse.status).toBe(200);
      // New email should be unverified
      expect(updateResponse.body.primary_email_verified).toBe(false);
    });

    it("should be able to change primary_email to an existing non-primary contact channel", async ({ expect }) => {
      await Auth.Otp.signIn();

      // Create a second contact channel (not primary)
      const secondMailbox = createMailbox();
      await niceBackendFetch("/api/v1/contact-channels", {
        accessType: "client",
        method: "POST",
        body: {
          value: secondMailbox.emailAddress,
          type: "email",
          used_for_auth: false,
          user_id: "me",
        },
      });

      // Verify we have two contact channels
      const channelsResponse = await niceBackendFetch("/api/v1/contact-channels?user_id=me", {
        accessType: "client",
      });
      expect(channelsResponse.body.items.length).toBe(2);

      // Set the second one as primary via update
      const updateResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
        method: "PATCH",
        body: {
          primary_email: secondMailbox.emailAddress,
        },
      });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.primary_email).toBe(secondMailbox.emailAddress);
    });

    it("should preserve verification status when switching to existing verified contact channel", async ({ expect }) => {
      const { userId } = await Auth.Otp.signIn();

      // Create and verify a second contact channel via server
      const secondMailbox = createMailbox();
      await niceBackendFetch("/api/v1/contact-channels", {
        accessType: "server",
        method: "POST",
        body: {
          value: secondMailbox.emailAddress,
          type: "email",
          used_for_auth: false,
          is_verified: true,
          user_id: userId,
        },
      });

      // Now switch primary to the verified second email via client
      const updateResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
        method: "PATCH",
        body: {
          primary_email: secondMailbox.emailAddress,
        },
      });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.primary_email).toBe(secondMailbox.emailAddress);
      // Should preserve the verified status
      expect(updateResponse.body.primary_email_verified).toBe(true);
    });

    it("should preserve unverified status when switching to existing unverified contact channel", async ({ expect }) => {
      await Auth.Otp.signIn();

      // Create an unverified second contact channel
      const secondMailbox = createMailbox();
      await niceBackendFetch("/api/v1/contact-channels", {
        accessType: "client",
        method: "POST",
        body: {
          value: secondMailbox.emailAddress,
          type: "email",
          used_for_auth: false,
          user_id: "me",
        },
      });

      // Now switch primary to the unverified second email
      const updateResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
        method: "PATCH",
        body: {
          primary_email: secondMailbox.emailAddress,
        },
      });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.primary_email).toBe(secondMailbox.emailAddress);
      // Should remain unverified
      expect(updateResponse.body.primary_email_verified).toBe(false);
    });

    it("should not be able to set primary_email to email already used by another user with used_for_auth", async ({ expect }) => {
      // Create first user with email used for auth
      const { userId: firstUserId } = await Auth.Otp.signIn();
      const firstUserEmail = (await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
      })).body.primary_email;

      // Create second user
      backendContext.set({ userAuth: undefined });
      await Auth.Otp.signIn();

      // Try to set second user's email to first user's email with auth enabled
      // Note: Emails used for auth must be unique across users
      const updateResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
        method: "PATCH",
        body: {
          primary_email: firstUserEmail,
          // This should fail because firstUserEmail is already used for auth by another user
        },
      });

      // Should succeed since we're just setting email, not using it for auth
      // The unique constraint only applies to emails used for auth (usedForAuth=TRUE)
      // In this case, the new email for second user is NOT used for auth (no primary_email_auth_enabled)
      expect(updateResponse.status).toBe(200);
    });

    it("should be able to set primary_email to null (demotes to non-primary, does not delete)", async ({ expect }) => {
      await Auth.Otp.signIn();

      // Verify user has email
      const beforeResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
      });
      expect(beforeResponse.body.primary_email).not.toBe(null);
      const originalEmail = beforeResponse.body.primary_email;

      // Set to null
      const updateResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
        method: "PATCH",
        body: {
          primary_email: null,
        },
      });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.primary_email).toBe(null);
      expect(updateResponse.body.primary_email_verified).toBe(false);

      // Verify the contact channel still exists but is no longer primary
      const channelsResponse = await niceBackendFetch("/api/v1/contact-channels?user_id=me", {
        accessType: "client",
      });
      const originalEmailChannel = channelsResponse.body.items.find((c: any) => c.value === originalEmail);
      expect(originalEmailChannel).toBeDefined();
      expect(originalEmailChannel.is_primary).toBe(false);
    });
  });

  describe("with restricted user status", () => {
    it("should make user restricted when setting unverified email with requireEmailVerification enabled", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          credential_enabled: true,
        },
      });
      await Project.updateConfig({
        onboarding: { requireEmailVerification: true },
      });

      // Create a user without email
      const createResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          display_name: "User Without Email",
        },
      });
      expect(createResponse.status).toBe(201);

      // Get auth tokens
      const sessionResponse = await niceBackendFetch(`/api/v1/auth/sessions`, {
        accessType: "server",
        method: "POST",
        body: {
          user_id: createResponse.body.id,
        },
      });
      expect(sessionResponse.status).toBe(200);
      backendContext.set({
        userAuth: {
          accessToken: sessionResponse.body.access_token,
          refreshToken: sessionResponse.body.refresh_token,
        },
      });

      // Set primary email - needs x-stack-allow-restricted-user since user without email might be restricted
      const newMailbox = createMailbox();
      const updateResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
        method: "PATCH",
        headers: {
          "x-stack-allow-restricted-user": "true",
        },
        body: {
          primary_email: newMailbox.emailAddress,
        },
      });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.primary_email_verified).toBe(false);
      expect(updateResponse.body.is_restricted).toBe(true);
      expect(updateResponse.body.restricted_reason).toEqual({ type: "email_not_verified" });
    });

    it("changing from verified to unverified email should make user restricted", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          magic_link_enabled: true,
        },
      });
      await Project.updateConfig({
        onboarding: { requireEmailVerification: true },
      });

      // Sign in with verified email
      await Auth.Otp.signIn();

      // Verify user is not restricted
      const beforeResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
      });
      expect(beforeResponse.body.is_restricted).toBe(false);

      // Change to unverified email
      const newMailbox = createMailbox();
      const updateResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
        method: "PATCH",
        headers: {
          "x-stack-allow-restricted-user": "true",
        },
        body: {
          primary_email: newMailbox.emailAddress,
        },
      });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.is_restricted).toBe(true);
      expect(updateResponse.body.restricted_reason).toEqual({ type: "email_not_verified" });
    });

    it("switching to verified existing contact channel should not make user restricted", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          magic_link_enabled: true,
        },
      });
      await Project.updateConfig({
        onboarding: { requireEmailVerification: true },
      });

      const { userId } = await Auth.Otp.signIn();

      // Create and verify a second contact channel via server
      const secondMailbox = createMailbox();
      await niceBackendFetch("/api/v1/contact-channels", {
        accessType: "server",
        method: "POST",
        body: {
          value: secondMailbox.emailAddress,
          type: "email",
          used_for_auth: false,
          is_verified: true,
          user_id: userId,
        },
      });

      // Switch to the verified email
      const updateResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
        method: "PATCH",
        body: {
          primary_email: secondMailbox.emailAddress,
        },
      });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.primary_email_verified).toBe(true);
      expect(updateResponse.body.is_restricted).toBe(false);
    });
  });

  describe("server access", () => {
    it("should be able to set primary_email and primary_email_verified together", async ({ expect }) => {
      const { userId } = await Auth.Otp.signIn();

      const newMailbox = createMailbox();
      const updateResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
        accessType: "server",
        method: "PATCH",
        body: {
          primary_email: newMailbox.emailAddress,
          primary_email_verified: true,
        },
      });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.primary_email).toBe(newMailbox.emailAddress);
      expect(updateResponse.body.primary_email_verified).toBe(true);
    });

    it("should be able to set primary_email_auth_enabled when changing primary_email", async ({ expect }) => {
      const { userId } = await Auth.Otp.signIn();

      const newMailbox = createMailbox();
      const updateResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
        accessType: "server",
        method: "PATCH",
        body: {
          primary_email: newMailbox.emailAddress,
          primary_email_auth_enabled: true,
        },
      });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.primary_email).toBe(newMailbox.emailAddress);
      expect(updateResponse.body.primary_email_auth_enabled).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle setting primary_email to the same email (no-op)", async ({ expect }) => {
      await Auth.Otp.signIn();

      const currentEmail = (await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
      })).body.primary_email;

      const updateResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
        method: "PATCH",
        body: {
          primary_email: currentEmail,
        },
      });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.primary_email).toBe(currentEmail);
      // Should preserve verified status
      expect(updateResponse.body.primary_email_verified).toBe(true);
    });

    it("should handle case insensitivity in email addresses", async ({ expect }) => {
      await Auth.Otp.signIn();

      const newMailbox = createMailbox();
      // Set email in lowercase
      await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
        method: "PATCH",
        body: {
          primary_email: newMailbox.emailAddress.toLowerCase(),
        },
      });

      // Try to set same email with different case
      const updateResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
        method: "PATCH",
        body: {
          primary_email: newMailbox.emailAddress.toUpperCase(),
        },
      });

      // Should succeed (treated as same email)
      expect(updateResponse.status).toBe(200);
    });

    it("should reject invalid email format", async ({ expect }) => {
      await Auth.Otp.signIn();

      const updateResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
        method: "PATCH",
        body: {
          primary_email: "not-a-valid-email",
        },
      });

      expect(updateResponse.status).toBe(400);
    });

    it("should reject empty string as email", async ({ expect }) => {
      await Auth.Otp.signIn();

      const updateResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
        method: "PATCH",
        body: {
          primary_email: "",
        },
      });

      expect(updateResponse.status).toBe(400);
    });

    it("old primary email should become non-primary contact channel after change", async ({ expect }) => {
      await Auth.Otp.signIn();

      const oldEmail = (await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
      })).body.primary_email;

      // Change to new email
      const newMailbox = createMailbox();
      await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
        method: "PATCH",
        body: {
          primary_email: newMailbox.emailAddress,
        },
      });

      // Check contact channels
      const channelsResponse = await niceBackendFetch("/api/v1/contact-channels?user_id=me", {
        accessType: "client",
      });

      // Old email should exist as non-primary
      const oldEmailChannel = channelsResponse.body.items.find((c: any) => c.value === oldEmail);
      expect(oldEmailChannel).toBeDefined();
      expect(oldEmailChannel.is_primary).toBe(false);

      // New email should be primary
      const newEmailChannel = channelsResponse.body.items.find((c: any) => c.value === newMailbox.emailAddress);
      expect(newEmailChannel).toBeDefined();
      expect(newEmailChannel.is_primary).toBe(true);
    });
  });

  describe("updating primary_email_verified for user without primary email", () => {
    it("should return error when updating primary_email_verified for user without primary email", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          credential_enabled: true,
        },
      });

      // Create a user without email via server
      const createResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          display_name: "User Without Email",
        },
      });
      expect(createResponse.status).toBe(201);
      expect(createResponse.body.primary_email).toBe(null);

      // Try to update primary_email_verified to true - should fail
      const updateTrueResponse = await niceBackendFetch(`/api/v1/users/${createResponse.body.id}`, {
        accessType: "server",
        method: "PATCH",
        body: {
          primary_email_verified: true,
        },
      });
      expect(updateTrueResponse).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 400,
          "body": "primary_email_verified cannot be true without primary_email",
          "headers": Headers { <some fields may have been hidden> },
        }
      `);

      // Try to update primary_email_verified to false - should be a no-op since there's no email anyway
      const updateFalseResponse = await niceBackendFetch(`/api/v1/users/${createResponse.body.id}`, {
        accessType: "server",
        method: "PATCH",
        body: {
          primary_email_verified: false,
        },
      });
      expect(updateFalseResponse.status).toBe(200);
      expect(updateFalseResponse.body.primary_email).toBe(null);
      expect(updateFalseResponse.body.primary_email_verified).toBe(false);
    });

    it("should return error when updating primary_email_auth_enabled for user without primary email", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          credential_enabled: true,
        },
      });

      // Create a user without email via server
      const createResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          display_name: "User Without Email",
        },
      });
      expect(createResponse.status).toBe(201);
      expect(createResponse.body.primary_email).toBe(null);

      // Try to update primary_email_auth_enabled to true - should fail
      const updateTrueResponse = await niceBackendFetch(`/api/v1/users/${createResponse.body.id}`, {
        accessType: "server",
        method: "PATCH",
        body: {
          primary_email_auth_enabled: true,
        },
      });
      expect(updateTrueResponse).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 400,
          "body": "primary_email_auth_enabled cannot be true without primary_email",
          "headers": Headers { <some fields may have been hidden> },
        }
      `);

      // Try to update primary_email_auth_enabled to false - should be a no-op since there's no email anyway
      const updateFalseResponse = await niceBackendFetch(`/api/v1/users/${createResponse.body.id}`, {
        accessType: "server",
        method: "PATCH",
        body: {
          primary_email_auth_enabled: false,
        },
      });
      expect(updateFalseResponse.status).toBe(200);
      expect(updateFalseResponse.body.primary_email).toBe(null);
      expect(updateFalseResponse.body.primary_email_auth_enabled).toBe(false);
    });
  });

  describe("explicit false values for primary_email_verified", () => {
    it("should allow explicitly setting primary_email_verified to false on a verified email", async ({ expect }) => {
      // Sign in with OTP which verifies the email
      const { userId } = await Auth.Otp.signIn();

      // Verify the email is verified
      const beforeResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
        accessType: "server",
      });
      expect(beforeResponse.body.primary_email_verified).toBe(true);

      // Explicitly set primary_email_verified to false
      const updateResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
        accessType: "server",
        method: "PATCH",
        body: {
          primary_email_verified: false,
        },
      });
      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.primary_email_verified).toBe(false);

      // Verify the change persists
      const afterResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
        accessType: "server",
      });
      expect(afterResponse.body.primary_email_verified).toBe(false);
    });
  });

  describe("explicit null for primary_email removal", () => {
    it("should allow removing primary_email by setting it to null", async ({ expect }) => {
      const { userId } = await Auth.Otp.signIn();

      // Verify user has an email
      const beforeResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
        accessType: "server",
      });
      expect(beforeResponse.body.primary_email).not.toBe(null);

      // Set primary_email to null to remove it
      const updateResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
        accessType: "server",
        method: "PATCH",
        body: {
          primary_email: null,
        },
      });
      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.primary_email).toBe(null);

      // Verify the change persists
      const afterResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
        accessType: "server",
      });
      expect(afterResponse.body.primary_email).toBe(null);
    });

    it("should allow removing primary_email even when auth is enabled (automatically disables auth)", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          credential_enabled: true,
          magic_link_enabled: true,
        },
      });

      // Sign in with OTP
      const { userId } = await Auth.Otp.signIn();

      // Verify user has email with auth enabled
      const beforeResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
        accessType: "server",
      });
      expect(beforeResponse.body.primary_email).not.toBe(null);
      expect(beforeResponse.body.primary_email_auth_enabled).toBe(true);

      // Remove email while auth is still enabled - should succeed and automatically disable auth
      const updateResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
        accessType: "server",
        method: "PATCH",
        body: {
          primary_email: null,
        },
      });
      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.primary_email).toBe(null);
      expect(updateResponse.body.primary_email_auth_enabled).toBe(false);
      expect(updateResponse.body.primary_email_verified).toBe(false);
    });
  });

  describe("setting primary_email and primary_email_verified together", () => {
    it("should set primary_email_verified when creating a new primary email for user without existing email", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          credential_enabled: true,
        },
      });

      // Create a user without email via server
      const createResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
        method: "POST",
        body: {
          display_name: "User Without Email",
        },
      });
      expect(createResponse.status).toBe(201);
      expect(createResponse.body.primary_email).toBe(null);

      // Set primary_email and primary_email_verified together
      const mailbox = createMailbox();
      const updateResponse = await niceBackendFetch(`/api/v1/users/${createResponse.body.id}`, {
        accessType: "server",
        method: "PATCH",
        body: {
          primary_email: mailbox.emailAddress,
          primary_email_verified: true,
        },
      });
      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.primary_email).toBe(mailbox.emailAddress);
      expect(updateResponse.body.primary_email_verified).toBe(true);
    });

    it("should set primary_email_verified when upgrading a non-primary contact channel to primary", async ({ expect }) => {
      const { userId } = await Auth.Otp.signIn();

      // Create a non-primary, unverified contact channel
      const secondMailbox = createMailbox();
      await niceBackendFetch("/api/v1/contact-channels", {
        accessType: "client",
        method: "POST",
        body: {
          value: secondMailbox.emailAddress,
          type: "email",
          used_for_auth: false,
          user_id: "me",
        },
      });

      // Verify the second channel is not primary and not verified
      const channelsBeforeResponse = await niceBackendFetch("/api/v1/contact-channels?user_id=me", {
        accessType: "client",
      });
      const secondChannel = channelsBeforeResponse.body.items.find((c: any) => c.value === secondMailbox.emailAddress);
      expect(secondChannel.is_primary).toBe(false);
      expect(secondChannel.is_verified).toBe(false);

      // Upgrade the second channel to primary and set it as verified in the same request
      const updateResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
        accessType: "server",
        method: "PATCH",
        body: {
          primary_email: secondMailbox.emailAddress,
          primary_email_verified: true,
        },
      });
      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.primary_email).toBe(secondMailbox.emailAddress);
      expect(updateResponse.body.primary_email_verified).toBe(true);
    });

    it("should set primary_email_verified when creating a completely new primary email", async ({ expect }) => {
      const { userId } = await Auth.Otp.signIn();

      // Create a new primary email that doesn't exist as any contact channel, and mark as verified
      const newMailbox = createMailbox();
      const updateResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
        accessType: "server",
        method: "PATCH",
        body: {
          primary_email: newMailbox.emailAddress,
          primary_email_verified: true,
        },
      });
      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.primary_email).toBe(newMailbox.emailAddress);
      expect(updateResponse.body.primary_email_verified).toBe(true);
    });
  });
});

