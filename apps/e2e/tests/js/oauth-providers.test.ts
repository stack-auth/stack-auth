import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { describe } from "vitest";
import { it } from "../helpers";
import { createApp } from "./js-helpers";

describe("OAuth Providers Client Functions", () => {
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

  it("should list OAuth providers for current user", async ({ expect }) => {
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
      allowSignIn: true,
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

    const providers = await currentUser.listOAuthProviders();

    expect(providers).toHaveLength(2);

    const spotifyProvider = providers.find((p) => p.type === "spotify");
    const githubProvider = providers.find((p) => p.type === "github");

    expect(spotifyProvider).toBeDefined();
    expect(spotifyProvider?.allowSignIn).toBe(true);
    expect(spotifyProvider?.allowConnectedAccounts).toBe(true);
    expect(spotifyProvider?.email).toBe("test@example.com");

    expect(githubProvider).toBeDefined();
    expect(githubProvider?.allowSignIn).toBe(false);
    expect(githubProvider?.allowConnectedAccounts).toBe(true);
    expect(githubProvider?.email).toBe("test@example.com");
  });

  it("should get specific OAuth provider by id", async ({ expect }) => {
    const apps = await createAppsWithOAuth();
    const user = await apps.serverApp.createUser({
      primaryEmail: "test@example.com",
      password: "password123",
      primaryEmailAuthEnabled: true,
    });

    const createdProviderResult = await apps.serverApp.createOAuthProvider({
      userId: user.id,
      providerConfigId: "spotify",
      accountId: "spotify_user_123",
      email: "test@example.com",
      allowSignIn: true,
      allowConnectedAccounts: true,
    });

    if (createdProviderResult.status === "error") {
      throw new Error("Failed to create OAuth provider");
    }

    const createdProvider = createdProviderResult.data!;

    await apps.clientApp.signInWithCredential({ email: "test@example.com", password: "password123" });
    const currentUser = await apps.clientApp.getUser({ or: "throw" });

    const provider = await currentUser.getOAuthProvider(createdProvider.id);

    expect(provider).toBeDefined();
    expect(provider?.id).toBe(createdProvider.id);
    expect(provider?.type).toBe("spotify");
    expect(provider?.allowSignIn).toBe(true);
    expect(provider?.allowConnectedAccounts).toBe(true);
    expect(provider?.email).toBe("test@example.com");
  });

  it("should return null when getting non-existent OAuth provider", async ({ expect }) => {
    const apps = await createAppsWithOAuth();
    await apps.serverApp.createUser({
      primaryEmail: "test@example.com",
      password: "password123",
      primaryEmailAuthEnabled: true,
    });

    await apps.clientApp.signInWithCredential({ email: "test@example.com", password: "password123" });
    const currentUser = await apps.clientApp.getUser({ or: "throw" });

    const provider = await currentUser.getOAuthProvider("non-existent-id");

    expect(provider).toBeNull();
  });

  it("should return empty list when user has no OAuth providers", async ({ expect }) => {
    const apps = await createAppsWithOAuth();
    await apps.serverApp.createUser({
      primaryEmail: "test@example.com",
      password: "password123",
      primaryEmailAuthEnabled: true,
    });

    await apps.clientApp.signInWithCredential({ email: "test@example.com", password: "password123" });
    const currentUser = await apps.clientApp.getUser({ or: "throw" });

    const providers = await currentUser.listOAuthProviders();

    expect(providers).toHaveLength(0);
  });

  it("should update OAuth provider settings", async ({ expect }) => {
    const apps = await createAppsWithOAuth();
    const user = await apps.serverApp.createUser({
      primaryEmail: "test@example.com",
      password: "password123",
      primaryEmailAuthEnabled: true,
    });

    const createdProviderResult = await apps.serverApp.createOAuthProvider({
      userId: user.id,
      providerConfigId: "spotify",
      accountId: "spotify_user_123",
      email: "test@example.com",
      allowSignIn: true,
      allowConnectedAccounts: true,
    });

    if (createdProviderResult.status === "error") {
      throw new Error("Failed to create OAuth provider");
    }

    const createdProvider = createdProviderResult.data!;

    await apps.clientApp.signInWithCredential({ email: "test@example.com", password: "password123" });
    const currentUser = await apps.clientApp.getUser({ or: "throw" });

    const provider = await currentUser.getOAuthProvider(createdProvider.id);
    expect(provider).toBeDefined();

    await provider!.update({ allowSignIn: false, allowConnectedAccounts: false });

    const updatedProvider = await currentUser.getOAuthProvider(createdProvider.id);
    expect(updatedProvider?.allowSignIn).toBe(false);
    expect(updatedProvider?.allowConnectedAccounts).toBe(false);
  });

  it("should delete OAuth provider", async ({ expect }) => {
    const apps = await createAppsWithOAuth();
    const user = await apps.serverApp.createUser({
      primaryEmail: "test@example.com",
      password: "password123",
      primaryEmailAuthEnabled: true,
    });

    const createdProviderResult = await apps.serverApp.createOAuthProvider({
      userId: user.id,
      providerConfigId: "spotify",
      accountId: "spotify_user_123",
      email: "test@example.com",
      allowSignIn: true,
      allowConnectedAccounts: true,
    });

    if (createdProviderResult.status === "error") {
      throw new Error("Failed to create OAuth provider");
    }

    const createdProvider = createdProviderResult.data!;

    await apps.clientApp.signInWithCredential({ email: "test@example.com", password: "password123" });
    const currentUser = await apps.clientApp.getUser({ or: "throw" });

    let provider = await currentUser.getOAuthProvider(createdProvider.id);
    expect(provider).toBeDefined();

    await provider!.delete();

    provider = await currentUser.getOAuthProvider(createdProvider.id);
    expect(provider).toBeNull();

    const providers = await currentUser.listOAuthProviders();
    expect(providers).toHaveLength(0);
  });

  it("should handle multiple OAuth providers of different types", async ({ expect }) => {
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
      allowSignIn: true,
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

    const providers = await currentUser.listOAuthProviders();

    expect(providers).toHaveLength(2);

    const providerTypes = providers.map((p: any) => p.type).sort((a, b) => stringCompare(a, b));
    expect(providerTypes).toEqual(["github", "spotify"]);

    const enabledForSignIn = providers.filter((p: any) => p.allowSignIn);
    expect(enabledForSignIn).toHaveLength(1);
    expect(enabledForSignIn[0].type).toBe("spotify");
  });

  it("should update OAuth provider email on server side", async ({ expect }) => {
    const apps = await createAppsWithOAuth();
    const user = await apps.serverApp.createUser({
      primaryEmail: "test@example.com",
      password: "password123",
      primaryEmailAuthEnabled: true,
    });

    const createdProviderResult = await apps.serverApp.createOAuthProvider({
      userId: user.id,
      providerConfigId: "spotify",
      accountId: "spotify_user_123",
      email: "test@example.com",
      allowSignIn: true,
      allowConnectedAccounts: true,
    });

    if (createdProviderResult.status === "error") {
      throw new Error("Failed to create OAuth provider");
    }

    const createdProvider = createdProviderResult.data!;

    await createdProvider.update({ email: "updated@example.com" });

    await apps.clientApp.signInWithCredential({ email: "test@example.com", password: "password123" });
    const currentUser = await apps.clientApp.getUser({ or: "throw" });

    const provider = await currentUser.getOAuthProvider(createdProvider.id);
    expect(provider?.email).toBe("updated@example.com");
  });
});
