import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { describe } from "vitest";
import { it } from "../helpers";
import { createApp } from "./js-helpers";

describe("Connected Accounts SDK Functions", () => {
  async function createAppsWithOAuth() {
    return await createApp({
      config: {
        magicLinkEnabled: true,
        oauthProviders: [
          {
            id: "spotify",
            type: "standard",
            clientId: "test_client_id",
            clientSecret: "test_client_secret",
          },
          {
            id: "github",
            type: "standard",
            clientId: "test_github_client_id",
            clientSecret: "test_github_client_secret",
          }
        ]
      }
    });
  }

  describe("listConnectedAccounts", () => {
    it("should return empty list when user has no connected accounts", async ({ expect }) => {
      const apps = await createAppsWithOAuth();
      await apps.serverApp.createUser({
        primaryEmail: "test@example.com",
        password: "password123",
        primaryEmailAuthEnabled: true,
      });

      await apps.clientApp.signInWithCredential({ email: "test@example.com", password: "password123" });
      const currentUser = await apps.clientApp.getUser({ or: "throw" });

      const connectedAccounts = await currentUser.listConnectedAccounts();

      expect(connectedAccounts).toHaveLength(0);
    });

    it("should list all connected accounts for the current user", async ({ expect }) => {
      const apps = await createAppsWithOAuth();
      const user = await apps.serverApp.createUser({
        primaryEmail: "test@example.com",
        password: "password123",
        primaryEmailAuthEnabled: true,
      });

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "spotify",
        accountId: "spotify_user_123",
        email: "test@example.com",
        allowSignIn: false,
        allowConnectedAccounts: true,
      });

      await apps.clientApp.signInWithCredential({ email: "test@example.com", password: "password123" });
      const currentUser = await apps.clientApp.getUser({ or: "throw" });

      const connectedAccounts = await currentUser.listConnectedAccounts();

      expect(connectedAccounts).toHaveLength(1);
      expect(connectedAccounts[0].provider).toBe("spotify");
      expect(connectedAccounts[0].providerAccountId).toBe("spotify_user_123");
      // Verify deprecated id field still works
      expect(connectedAccounts[0].id).toBe("spotify");
    });

    it("should list multiple connected accounts from different providers", async ({ expect }) => {
      const apps = await createAppsWithOAuth();
      const user = await apps.serverApp.createUser({
        primaryEmail: "test@example.com",
        password: "password123",
        primaryEmailAuthEnabled: true,
      });

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "spotify",
        accountId: "spotify_user_123",
        email: "test@example.com",
        allowSignIn: false,
        allowConnectedAccounts: true,
      });

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "github",
        accountId: "github_user_456",
        email: "test@example.com",
        allowSignIn: false,
        allowConnectedAccounts: true,
      });

      await apps.clientApp.signInWithCredential({ email: "test@example.com", password: "password123" });
      const currentUser = await apps.clientApp.getUser({ or: "throw" });

      const connectedAccounts = await currentUser.listConnectedAccounts();

      expect(connectedAccounts).toHaveLength(2);
      const providerIds = connectedAccounts.map(a => a.provider).sort((a, b) => stringCompare(a, b));
      expect(providerIds).toEqual(["github", "spotify"]);
    });

    it("should list multiple connected accounts from the same provider", async ({ expect }) => {
      const apps = await createAppsWithOAuth();
      const user = await apps.serverApp.createUser({
        primaryEmail: "test@example.com",
        password: "password123",
        primaryEmailAuthEnabled: true,
      });

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "spotify",
        accountId: "spotify_user_123",
        email: "alice@example.com",
        allowSignIn: false,
        allowConnectedAccounts: true,
      });

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "spotify",
        accountId: "spotify_user_456",
        email: "bob@example.com",
        allowSignIn: false,
        allowConnectedAccounts: true,
      });

      await apps.clientApp.signInWithCredential({ email: "test@example.com", password: "password123" });
      const currentUser = await apps.clientApp.getUser({ or: "throw" });

      const connectedAccounts = await currentUser.listConnectedAccounts();

      expect(connectedAccounts).toHaveLength(2);
      expect(connectedAccounts[0].provider).toBe("spotify");
      expect(connectedAccounts[1].provider).toBe("spotify");

      const accountIds = connectedAccounts.map(a => a.providerAccountId).sort();
      expect(accountIds).toEqual(["spotify_user_123", "spotify_user_456"]);
    });

    it("should only list accounts where allow_connected_accounts is true", async ({ expect }) => {
      const apps = await createAppsWithOAuth();
      const user = await apps.serverApp.createUser({
        primaryEmail: "test@example.com",
        password: "password123",
        primaryEmailAuthEnabled: true,
      });

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "spotify",
        accountId: "spotify_connected",
        email: "connected@example.com",
        allowSignIn: false,
        allowConnectedAccounts: true,
      });

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "github",
        accountId: "github_not_connected",
        email: "not-connected@example.com",
        allowSignIn: true,
        allowConnectedAccounts: false,
      });

      await apps.clientApp.signInWithCredential({ email: "test@example.com", password: "password123" });
      const currentUser = await apps.clientApp.getUser({ or: "throw" });

      const connectedAccounts = await currentUser.listConnectedAccounts();

      expect(connectedAccounts).toHaveLength(1);
      expect(connectedAccounts[0].provider).toBe("spotify");
      expect(connectedAccounts[0].providerAccountId).toBe("spotify_connected");
    });
  });

  describe("getConnectedAccount with provider only (backward compat)", () => {
    it("should return null when no connected account exists for provider", async ({ expect }) => {
      const apps = await createAppsWithOAuth();
      await apps.serverApp.createUser({
        primaryEmail: "test@example.com",
        password: "password123",
        primaryEmailAuthEnabled: true,
      });

      await apps.clientApp.signInWithCredential({ email: "test@example.com", password: "password123" });
      const currentUser = await apps.clientApp.getUser({ or: "throw" });

      const connection = await currentUser.getConnectedAccount("spotify");

      expect(connection).toBeNull();
    });

    it("should return null for manually-created provider without tokens", async ({ expect }) => {
      // The legacy getConnectedAccount(provider) also checks for access token availability.
      // A manually-created OAuth provider (via server API) doesn't have tokens, so it returns null.
      const apps = await createAppsWithOAuth();
      const user = await apps.serverApp.createUser({
        primaryEmail: "test@example.com",
        password: "password123",
        primaryEmailAuthEnabled: true,
      });

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "spotify",
        accountId: "spotify_user_123",
        email: "test@example.com",
        allowSignIn: false,
        allowConnectedAccounts: true,
      });

      await apps.clientApp.signInWithCredential({ email: "test@example.com", password: "password123" });
      const currentUser = await apps.clientApp.getUser({ or: "throw" });

      // Legacy getConnectedAccount returns null because no access token is available
      const connection = await currentUser.getConnectedAccount("spotify");
      expect(connection).toBeNull();

      // But the new object-based API finds the account via the list endpoint
      const specificConnection = await currentUser.getConnectedAccount({
        provider: "spotify",
        providerAccountId: "spotify_user_123",
      });
      expect(specificConnection).not.toBeNull();
      expect(specificConnection?.provider).toBe("spotify");
      expect(specificConnection?.providerAccountId).toBe("spotify_user_123");
    });
  });

  describe("getConnectedAccount with { provider, providerAccountId }", () => {
    it("should return null when no account matches", async ({ expect }) => {
      const apps = await createAppsWithOAuth();
      const user = await apps.serverApp.createUser({
        primaryEmail: "test@example.com",
        password: "password123",
        primaryEmailAuthEnabled: true,
      });

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "spotify",
        accountId: "spotify_user_123",
        email: "test@example.com",
        allowSignIn: false,
        allowConnectedAccounts: true,
      });

      await apps.clientApp.signInWithCredential({ email: "test@example.com", password: "password123" });
      const currentUser = await apps.clientApp.getUser({ or: "throw" });

      const connection = await currentUser.getConnectedAccount({
        provider: "spotify",
        providerAccountId: "non_existent_account"
      });

      expect(connection).toBeNull();
    });

    it("should return specific connected account by provider and providerAccountId", async ({ expect }) => {
      const apps = await createAppsWithOAuth();
      const user = await apps.serverApp.createUser({
        primaryEmail: "test@example.com",
        password: "password123",
        primaryEmailAuthEnabled: true,
      });

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "spotify",
        accountId: "spotify_user_alice",
        email: "alice@example.com",
        allowSignIn: false,
        allowConnectedAccounts: true,
      });

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "spotify",
        accountId: "spotify_user_bob",
        email: "bob@example.com",
        allowSignIn: false,
        allowConnectedAccounts: true,
      });

      await apps.clientApp.signInWithCredential({ email: "test@example.com", password: "password123" });
      const currentUser = await apps.clientApp.getUser({ or: "throw" });

      const connection = await currentUser.getConnectedAccount({
        provider: "spotify",
        providerAccountId: "spotify_user_bob"
      });

      expect(connection).not.toBeNull();
      expect(connection?.provider).toBe("spotify");
      expect(connection?.providerAccountId).toBe("spotify_user_bob");
    });

    it("should distinguish between accounts from same provider", async ({ expect }) => {
      const apps = await createAppsWithOAuth();
      const user = await apps.serverApp.createUser({
        primaryEmail: "test@example.com",
        password: "password123",
        primaryEmailAuthEnabled: true,
      });

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "spotify",
        accountId: "account_one",
        email: "one@example.com",
        allowSignIn: false,
        allowConnectedAccounts: true,
      });

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "spotify",
        accountId: "account_two",
        email: "two@example.com",
        allowSignIn: false,
        allowConnectedAccounts: true,
      });

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "spotify",
        accountId: "account_three",
        email: "three@example.com",
        allowSignIn: false,
        allowConnectedAccounts: true,
      });

      await apps.clientApp.signInWithCredential({ email: "test@example.com", password: "password123" });
      const currentUser = await apps.clientApp.getUser({ or: "throw" });

      // Get each account specifically
      const one = await currentUser.getConnectedAccount({ provider: "spotify", providerAccountId: "account_one" });
      const two = await currentUser.getConnectedAccount({ provider: "spotify", providerAccountId: "account_two" });
      const three = await currentUser.getConnectedAccount({ provider: "spotify", providerAccountId: "account_three" });
      const nonexistent = await currentUser.getConnectedAccount({ provider: "spotify", providerAccountId: "account_four" });

      expect(one).not.toBeNull();
      expect(two).not.toBeNull();
      expect(three).not.toBeNull();
      expect(nonexistent).toBeNull();

      expect(one?.providerAccountId).toBe("account_one");
      expect(two?.providerAccountId).toBe("account_two");
      expect(three?.providerAccountId).toBe("account_three");
    });
  });

  describe("Server-side connected accounts", () => {
    it("should list connected accounts for a user via server app", async ({ expect }) => {
      const apps = await createAppsWithOAuth();
      const user = await apps.serverApp.createUser({
        primaryEmail: "test@example.com",
        password: "password123",
        primaryEmailAuthEnabled: true,
      });

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "spotify",
        accountId: "spotify_user_123",
        email: "test@example.com",
        allowSignIn: false,
        allowConnectedAccounts: true,
      });

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "github",
        accountId: "github_user_456",
        email: "test@example.com",
        allowSignIn: false,
        allowConnectedAccounts: true,
      });

      const serverUser = await apps.serverApp.getUser(user.id);
      expect(serverUser).not.toBeNull();

      const connectedAccounts = await serverUser!.listConnectedAccounts();

      expect(connectedAccounts).toHaveLength(2);
      const providerIds = connectedAccounts.map(a => a.provider).sort((a, b) => stringCompare(a, b));
      expect(providerIds).toEqual(["github", "spotify"]);
    });

    it("should get specific connected account via server app", async ({ expect }) => {
      const apps = await createAppsWithOAuth();
      const user = await apps.serverApp.createUser({
        primaryEmail: "test@example.com",
        password: "password123",
        primaryEmailAuthEnabled: true,
      });

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "spotify",
        accountId: "spotify_specific_account",
        email: "test@example.com",
        allowSignIn: false,
        allowConnectedAccounts: true,
      });

      const serverUser = await apps.serverApp.getUser(user.id);
      expect(serverUser).not.toBeNull();

      const connection = await serverUser!.getConnectedAccount({
        provider: "spotify",
        providerAccountId: "spotify_specific_account"
      });

      expect(connection).not.toBeNull();
      expect(connection?.provider).toBe("spotify");
      expect(connection?.providerAccountId).toBe("spotify_specific_account");
    });

    it("should return empty list for user with no connected accounts via server app", async ({ expect }) => {
      const apps = await createAppsWithOAuth();
      const user = await apps.serverApp.createUser({
        primaryEmail: "test@example.com",
        password: "password123",
        primaryEmailAuthEnabled: true,
      });

      const serverUser = await apps.serverApp.getUser(user.id);
      expect(serverUser).not.toBeNull();

      const connectedAccounts = await serverUser!.listConnectedAccounts();

      expect(connectedAccounts).toHaveLength(0);
    });
  });

  describe("OAuthConnection type structure", () => {
    it("should have correct fields on Connection type", async ({ expect }) => {
      const apps = await createAppsWithOAuth();
      const user = await apps.serverApp.createUser({
        primaryEmail: "test@example.com",
        password: "password123",
        primaryEmailAuthEnabled: true,
      });

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "spotify",
        accountId: "spotify_user_123",
        email: "test@example.com",
        allowSignIn: false,
        allowConnectedAccounts: true,
      });

      await apps.clientApp.signInWithCredential({ email: "test@example.com", password: "password123" });
      const currentUser = await apps.clientApp.getUser({ or: "throw" });

      const connectedAccounts = await currentUser.listConnectedAccounts();
      expect(connectedAccounts).toHaveLength(1);

      const account = connectedAccounts[0];

      // Verify required fields
      expect(account.provider).toBeDefined();
      expect(typeof account.provider).toBe("string");

      expect(account.providerAccountId).toBeDefined();
      expect(typeof account.providerAccountId).toBe("string");

      // Verify deprecated id field exists and equals provider
      expect(account.id).toBeDefined();
      expect(account.id).toBe(account.provider);

      // Verify access token methods exist
      expect(typeof account.getAccessToken).toBe("function");
    });
  });

  describe("Edge cases", () => {
    it("should handle special characters in providerAccountId", async ({ expect }) => {
      const apps = await createAppsWithOAuth();
      const user = await apps.serverApp.createUser({
        primaryEmail: "test@example.com",
        password: "password123",
        primaryEmailAuthEnabled: true,
      });

      const specialAccountId = "user+test@example.com/path?query=value&other=123";

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "spotify",
        accountId: specialAccountId,
        email: "test@example.com",
        allowSignIn: false,
        allowConnectedAccounts: true,
      });

      await apps.clientApp.signInWithCredential({ email: "test@example.com", password: "password123" });
      const currentUser = await apps.clientApp.getUser({ or: "throw" });

      const connectedAccounts = await currentUser.listConnectedAccounts();
      expect(connectedAccounts).toHaveLength(1);
      expect(connectedAccounts[0].providerAccountId).toBe(specialAccountId);

      // Try to get the account with special characters
      const connection = await currentUser.getConnectedAccount({
        provider: "spotify",
        providerAccountId: specialAccountId
      });

      expect(connection).not.toBeNull();
      expect(connection?.providerAccountId).toBe(specialAccountId);
    });

    it("should handle unicode characters in providerAccountId", async ({ expect }) => {
      const apps = await createAppsWithOAuth();
      const user = await apps.serverApp.createUser({
        primaryEmail: "test@example.com",
        password: "password123",
        primaryEmailAuthEnabled: true,
      });

      const unicodeAccountId = "用户123_🎵_café";

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "spotify",
        accountId: unicodeAccountId,
        email: "test@example.com",
        allowSignIn: false,
        allowConnectedAccounts: true,
      });

      await apps.clientApp.signInWithCredential({ email: "test@example.com", password: "password123" });
      const currentUser = await apps.clientApp.getUser({ or: "throw" });

      const connectedAccounts = await currentUser.listConnectedAccounts();
      expect(connectedAccounts).toHaveLength(1);
      expect(connectedAccounts[0].providerAccountId).toBe(unicodeAccountId);
    });

    it("should not expose accounts from different providers when querying by specific account", async ({ expect }) => {
      const apps = await createAppsWithOAuth();
      const user = await apps.serverApp.createUser({
        primaryEmail: "test@example.com",
        password: "password123",
        primaryEmailAuthEnabled: true,
      });

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "spotify",
        accountId: "same_account_id",
        email: "test@example.com",
        allowSignIn: false,
        allowConnectedAccounts: true,
      });

      await apps.serverApp.createOAuthProvider({
        userId: user.id,
        providerConfigId: "github",
        accountId: "same_account_id",
        email: "test@example.com",
        allowSignIn: false,
        allowConnectedAccounts: true,
      });

      await apps.clientApp.signInWithCredential({ email: "test@example.com", password: "password123" });
      const currentUser = await apps.clientApp.getUser({ or: "throw" });

      // Query for spotify account
      const spotifyConnection = await currentUser.getConnectedAccount({
        provider: "spotify",
        providerAccountId: "same_account_id"
      });

      // Query for github account
      const githubConnection = await currentUser.getConnectedAccount({
        provider: "github",
        providerAccountId: "same_account_id"
      });

      // Query for non-existent provider
      const nonExistentProviderConnection = await currentUser.getConnectedAccount({
        provider: "facebook",
        providerAccountId: "same_account_id"
      });

      expect(spotifyConnection).not.toBeNull();
      expect(spotifyConnection?.provider).toBe("spotify");

      expect(githubConnection).not.toBeNull();
      expect(githubConnection?.provider).toBe("github");

      expect(nonExistentProviderConnection).toBeNull();
    });
  });
});
