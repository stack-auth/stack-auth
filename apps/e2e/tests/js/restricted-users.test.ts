import { describe } from "vitest";
import { it } from "../helpers";
import { createApp } from "./js-helpers";

throw new StackAssertionError("TODO: REVIEW");


describe("restricted user SDK filtering", () => {
  describe("getUser with includeRestricted option", () => {
    it("should return null for restricted user by default", async ({ expect }) => {
      const { clientApp, adminApp } = await createApp({
        config: {
          credentialEnabled: true,
        },
      });

      // Enable email verification requirement
      const project = await adminApp.getProject();
      await project.updateConfig({
        "onboarding.requireEmailVerification": true,
      });

      // Sign up a user (email won't be verified automatically)
      await clientApp.signUpWithCredential({
        email: "test-restricted@example.com",
        password: "password123",
        verificationCallbackUrl: "http://localhost:3000",
      });

      // By default, getUser should return null for restricted users
      const user = await clientApp.getUser();
      expect(user).toBeNull();
    });

    it("should return restricted user when includeRestricted is true", async ({ expect }) => {
      const { clientApp, adminApp } = await createApp({
        config: {
          credential_enabled: true,
        },
      });

      // Enable email verification requirement
      const project = await adminApp.getProject();
      await project.updateConfig({
        "onboarding.requireEmailVerification": true,
      });

      // Sign up a user (email won't be verified automatically)
      await clientApp.signUpWithCredential({
        email: "test-restricted@example.com",
        password: "password123",
        verificationCallbackUrl: "http://localhost:3000",
      });

      // With includeRestricted: true, should return the restricted user
      const user = await clientApp.getUser({ includeRestricted: true });
      expect(user).not.toBeNull();
      expect(user!.isRestricted).toBe(true);
      expect(user!.restrictedReason).toEqual({ type: "email_not_verified" });
    });

    it("should return non-restricted user without includeRestricted option", async ({ expect }) => {
      const { clientApp, adminApp } = await createApp({
        config: {
          magic_link_enabled: true,
        },
      });

      // Enable email verification requirement
      const project = await adminApp.getProject();
      await project.updateConfig({
        "onboarding.requireEmailVerification": true,
      });

      // Sign in with magic link (which verifies the email)
      const testEmail = `test-${Date.now()}@stack-js-test.example.com`;
      const { nonce } = await clientApp.sendMagicLinkEmail(testEmail);

      // Get the magic link code
      const magicLinkCode = await clientApp.internal.getMagicLinkCode({
        email: testEmail,
        nonce,
      });

      // Sign in with the magic link code
      await clientApp.signInWithMagicLink({
        code: magicLinkCode,
      });

      // User should be returned since they're verified (not restricted)
      const user = await clientApp.getUser();
      expect(user).not.toBeNull();
      expect(user!.isRestricted).toBe(false);
      expect(user!.primaryEmailVerified).toBe(true);
    });

    it("should throw error when or: anonymous is combined with includeRestricted: false", async ({ expect }) => {
      const { clientApp } = await createApp({});

      await expect(
        clientApp.getUser({ or: "anonymous", includeRestricted: false })
      ).rejects.toThrow("Cannot use { or: 'anonymous' } with { includeRestricted: false }");
    });

    it("should include restricted users when or: anonymous is used (without explicit includeRestricted)", async ({ expect }) => {
      const { clientApp, adminApp, serverApp } = await createApp({
        config: {
          credential_enabled: true,
          anonymous_authentication_enabled: true,
        },
      });

      // Enable email verification requirement
      const project = await adminApp.getProject();
      await project.updateConfig({
        "onboarding.requireEmailVerification": true,
      });

      // Sign up a user (email won't be verified automatically)
      await clientApp.signUpWithCredential({
        email: "test-restricted@example.com",
        password: "password123",
        verificationCallbackUrl: "http://localhost:3000",
      });

      // With or: "anonymous", restricted users should be implicitly included
      // (This won't create an anonymous user since we already have a restricted user)
      const user = await clientApp.getUser({ or: "anonymous" });
      expect(user).not.toBeNull();
      expect(user!.isRestricted).toBe(true);
    });
  });

  describe("server app getUser with includeRestricted option", () => {
    it("should return null for restricted user by default on server app", async ({ expect }) => {
      const { serverApp, clientApp, adminApp } = await createApp({
        config: {
          credential_enabled: true,
        },
      });

      // Enable email verification requirement
      const project = await adminApp.getProject();
      await project.updateConfig({
        "onboarding.requireEmailVerification": true,
      });

      // Sign up a user (email won't be verified automatically)
      await clientApp.signUpWithCredential({
        email: "test-restricted@example.com",
        password: "password123",
        verificationCallbackUrl: "http://localhost:3000",
      });

      // Get the tokens
      const authJson = await clientApp.getAuthJson();

      // By default, getUser should return null for restricted users
      const user = await serverApp.getUser({ tokenStore: authJson as any });
      expect(user).toBeNull();
    });

    it("should return restricted user when includeRestricted is true on server app", async ({ expect }) => {
      const { serverApp, clientApp, adminApp } = await createApp({
        config: {
          credential_enabled: true,
        },
      });

      // Enable email verification requirement
      const project = await adminApp.getProject();
      await project.updateConfig({
        "onboarding.requireEmailVerification": true,
      });

      // Sign up a user (email won't be verified automatically)
      await clientApp.signUpWithCredential({
        email: "test-restricted@example.com",
        password: "password123",
        verificationCallbackUrl: "http://localhost:3000",
      });

      // Get the tokens
      const authJson = await clientApp.getAuthJson();

      // With includeRestricted: true, should return the restricted user
      const user = await serverApp.getUser({ tokenStore: authJson as any, includeRestricted: true });
      expect(user).not.toBeNull();
      expect(user!.isRestricted).toBe(true);
    });

    it("should throw error when or: anonymous is combined with includeRestricted: false on server app", async ({ expect }) => {
      const { serverApp } = await createApp({});

      await expect(
        serverApp.getUser({ or: "anonymous", includeRestricted: false })
      ).rejects.toThrow("Cannot use { or: 'anonymous' } with { includeRestricted: false }");
    });
  });

  describe("transition from restricted to non-restricted", () => {
    it("should return user after email verification even without includeRestricted", async ({ expect }) => {
      const { clientApp, adminApp } = await createApp({
        config: {
          credential_enabled: true,
        },
      });

      // Enable email verification requirement
      const project = await adminApp.getProject();
      await project.updateConfig({
        "onboarding.requireEmailVerification": true,
      });

      // Sign up a user (email won't be verified automatically)
      await clientApp.signUpWithCredential({
        email: "test-restricted@example.com",
        password: "password123",
        verificationCallbackUrl: "http://localhost:3000",
      });

      // By default, getUser should return null for restricted users
      let user = await clientApp.getUser();
      expect(user).toBeNull();

      // Get the restricted user with includeRestricted
      const restrictedUser = await clientApp.getUser({ includeRestricted: true });
      expect(restrictedUser).not.toBeNull();
      expect(restrictedUser!.isRestricted).toBe(true);

      // Verify the email (using internal API)
      const contactChannels = await restrictedUser!.listContactChannels();
      const emailChannel = contactChannels.find(c => c.type === "email" && c.value === "test-restricted@example.com");
      expect(emailChannel).toBeDefined();

      // Use server API to verify the email
      const adminAppProject = await adminApp.getProject();
      const serverUsers = await adminAppProject.listUsers({ query: "test-restricted@example.com" });
      expect(serverUsers.length).toBeGreaterThan(0);

      // Update primary email to be verified (simulating verification)
      const serverUser = serverUsers[0];
      const serverContactChannels = await serverUser.listContactChannels();
      const serverEmailChannel = serverContactChannels.find(c => c.type === "email" && c.value === "test-restricted@example.com");
      if (serverEmailChannel) {
        await serverEmailChannel.update({ isVerified: true });
      }

      // Now user should be returned without includeRestricted
      user = await clientApp.getUser();
      expect(user).not.toBeNull();
      expect(user!.isRestricted).toBe(false);
    });
  });
});
