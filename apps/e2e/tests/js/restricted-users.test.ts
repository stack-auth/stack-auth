import { describe } from "vitest";
import { it } from "../helpers";
import { createApp } from "./js-helpers";


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

      // With includeRestricted: true, should return the restricted user
      const user = await clientApp.getUser({ includeRestricted: true });
      expect(user).not.toBeNull();
      expect(user!.isRestricted).toBe(true);
      expect(user!.restrictedReason).toEqual({ type: "email_not_verified" });
    });

    it("should return non-restricted user without includeRestricted option", async ({ expect }) => {
      const { clientApp, adminApp, serverApp } = await createApp({
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
        email: "test-verified@example.com",
        password: "password123",
        verificationCallbackUrl: "http://localhost:3000",
      });

      // User should be restricted at first
      const restrictedUser = await clientApp.getUser({ includeRestricted: true });
      expect(restrictedUser).not.toBeNull();
      expect(restrictedUser!.isRestricted).toBe(true);

      // Verify the email using server SDK
      const serverUsers = await serverApp.listUsers({ query: "test-verified@example.com", includeRestricted: true });
      expect(serverUsers.length).toBeGreaterThan(0);

      const serverUser = serverUsers[0];
      const serverContactChannels = await serverUser.listContactChannels();
      const serverEmailChannel = serverContactChannels.find(c => c.value === "test-verified@example.com");
      if (serverEmailChannel) {
        await serverEmailChannel.update({ isVerified: true });
      }

      // Now user should be returned without includeRestricted since they're verified
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

    it("should return the same restricted user when or: anonymous is used (without explicit includeRestricted)", async ({ expect }) => {
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

      // Get the restricted user with includeRestricted to capture its ID
      const restrictedUser = await clientApp.getUser({ includeRestricted: true });
      expect(restrictedUser).not.toBeNull();
      expect(restrictedUser!.isRestricted).toBe(true);
      const restrictedUserId = restrictedUser!.id;

      // With or: "anonymous", should return the SAME restricted user (not create a new anonymous user)
      const userWithAnonymousFallback = await clientApp.getUser({ or: "anonymous" });
      expect(userWithAnonymousFallback).not.toBeNull();
      expect(userWithAnonymousFallback!.id).toBe(restrictedUserId);
      expect(userWithAnonymousFallback!.isRestricted).toBe(true);
      expect(userWithAnonymousFallback!.isAnonymous).toBe(false);
    });
  });

  describe("server app getUser with includeRestricted option", () => {
    it("should return null for restricted user by default on server app", async ({ expect }) => {
      const { serverApp, clientApp, adminApp } = await createApp({
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

      // Get the tokens from the restricted user (must use includeRestricted to get the user first)
      const restrictedUser = await clientApp.getUser({ includeRestricted: true });
      expect(restrictedUser).not.toBeNull();
      const authJson = await restrictedUser!.getAuthJson();

      // By default, getUser should return null for restricted users
      const user = await serverApp.getUser({ tokenStore: authJson as any });
      expect(user).toBeNull();
    });

    it("should return restricted user when includeRestricted is true on server app", async ({ expect }) => {
      const { serverApp, clientApp, adminApp } = await createApp({
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

      // Get the tokens from the restricted user (must use includeRestricted to get the user first)
      const restrictedUser = await clientApp.getUser({ includeRestricted: true });
      expect(restrictedUser).not.toBeNull();
      const authJson = await restrictedUser!.getAuthJson();

      // With includeRestricted: true, should return the restricted user
      const user = await serverApp.getUser({ tokenStore: authJson as any, includeRestricted: true });
      expect(user).not.toBeNull();
      expect(user!.isRestricted).toBe(true);
    });

    it("should return the same restricted user when or: anonymous is used on server app", async ({ expect }) => {
      const { serverApp, clientApp, adminApp } = await createApp({
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

      // Get the tokens from the restricted user
      const restrictedUser = await clientApp.getUser({ includeRestricted: true });
      expect(restrictedUser).not.toBeNull();
      const authJson = await restrictedUser!.getAuthJson();
      const restrictedUserId = restrictedUser!.id;

      // With or: "anonymous", should return the SAME restricted user (not create a new anonymous user)
      const userWithAnonymousFallback = await serverApp.getUser({ tokenStore: authJson as any, or: "anonymous" });
      expect(userWithAnonymousFallback).not.toBeNull();
      expect(userWithAnonymousFallback!.id).toBe(restrictedUserId);
      expect(userWithAnonymousFallback!.isRestricted).toBe(true);
      expect(userWithAnonymousFallback!.isAnonymous).toBe(false);
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
      const { clientApp, adminApp, serverApp } = await createApp({
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
      let user = await clientApp.getUser();
      expect(user).toBeNull();

      // Get the restricted user with includeRestricted
      const restrictedUser = await clientApp.getUser({ includeRestricted: true });
      expect(restrictedUser).not.toBeNull();
      expect(restrictedUser!.isRestricted).toBe(true);

      // Verify the email (using internal API)
      const contactChannels = await restrictedUser!.listContactChannels();
      const emailChannel = contactChannels.find(c => c.value === "test-restricted@example.com");
      expect(emailChannel).toBeDefined();

      // Use server API to verify the email
      const serverUsers = await serverApp.listUsers({ query: "test-restricted@example.com", includeRestricted: true });
      expect(serverUsers.length).toBeGreaterThan(0);

      // Update primary email to be verified (simulating verification)
      const serverUser = serverUsers[0];
      const serverContactChannels = await serverUser.listContactChannels();
      const serverEmailChannel = serverContactChannels.find(c => c.value === "test-restricted@example.com");
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
