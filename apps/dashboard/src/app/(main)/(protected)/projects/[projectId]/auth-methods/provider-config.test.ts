import type { CompleteConfig } from "@hexclave/shared/dist/config/schema";
import { describe, expect, test } from "vitest";
import { envConfigIsWritable, splitProviderConfig, type AdminOAuthProviderConfig } from "./provider-config";

const NEW_CALLBACK = "https://api.hexclave.example/api/v1/auth/oauth/callback/spotify";

type ConfigProvider = CompleteConfig['auth']['oauth']['providers'][string];

function existingStandard(overrides: Partial<ConfigProvider> = {}): ConfigProvider {
  const base: ConfigProvider = {
    type: "spotify",
    isShared: false,
    allowSignIn: true,
    allowConnectedAccounts: true,
    clientId: "old-client-id",
    clientSecret: "old-client-secret",
    customCallbackUrl: "https://api.stack-auth.example/api/v1/auth/oauth/callback/spotify",
    facebookConfigId: undefined,
    microsoftTenantId: undefined,
    appleBundles: undefined,
  };
  return { ...base, ...overrides };
}

describe("splitProviderConfig", () => {
  test("shared provider produces a branch-only update with enable fields and no env write", () => {
    const provider: AdminOAuthProviderConfig = { id: "spotify", type: "shared" };
    const { branchUpdate, envWrite } = splitProviderConfig(provider, undefined, NEW_CALLBACK);

    expect(branchUpdate).toEqual({
      "auth.oauth.providers.spotify": {
        type: "spotify",
        allowSignIn: true,
        allowConnectedAccounts: true,
      },
    });
    expect(envWrite).toBeUndefined();
  });

  test("standard provider produces branch enable fields plus env credential leaf keys", () => {
    const provider: AdminOAuthProviderConfig = {
      id: "spotify",
      type: "standard",
      clientId: "client-id",
      clientSecret: "client-secret",
    };
    const { branchUpdate, envWrite } = splitProviderConfig(provider, undefined, NEW_CALLBACK);

    expect(branchUpdate).toEqual({
      "auth.oauth.providers.spotify": {
        type: "spotify",
        allowSignIn: true,
        allowConnectedAccounts: true,
      },
    });
    // Credentials are leaf keys, never a whole object (which would clobber branch).
    // Undefined leaf keys are omitted (the hook resets the whole subtree first).
    expect(envWrite).toEqual({
      "auth.oauth.providers.spotify.isShared": false,
      "auth.oauth.providers.spotify.clientId": "client-id",
      "auth.oauth.providers.spotify.clientSecret": "client-secret",
      "auth.oauth.providers.spotify.customCallbackUrl": NEW_CALLBACK,
    });
    expect(envWrite).not.toHaveProperty("auth.oauth.providers.spotify.facebookConfigId");
    expect(envWrite).not.toHaveProperty("auth.oauth.providers.spotify.microsoftTenantId");
    expect(envWrite).not.toHaveProperty("auth.oauth.providers.spotify.appleBundles");
  });

  test("converting a brand-new standard provider uses the fresh hexclave callback URL", () => {
    const provider: AdminOAuthProviderConfig = {
      id: "spotify",
      type: "standard",
      clientId: "c",
      clientSecret: "s",
    };
    const { envWrite } = splitProviderConfig(provider, undefined, NEW_CALLBACK);
    expect(envWrite?.["auth.oauth.providers.spotify.customCallbackUrl"]).toBe(NEW_CALLBACK);
  });

  test("editing an already-standard provider preserves its existing customCallbackUrl", () => {
    const provider: AdminOAuthProviderConfig = {
      id: "spotify",
      type: "standard",
      clientId: "c",
      clientSecret: "s",
    };
    const existing = existingStandard({ customCallbackUrl: "https://legacy.example/cb" });
    const { envWrite } = splitProviderConfig(provider, existing, NEW_CALLBACK);
    expect(envWrite?.["auth.oauth.providers.spotify.customCallbackUrl"]).toBe("https://legacy.example/cb");
  });

  test("converting shared -> standard uses the fresh callback URL even if a shared 'existing' is passed", () => {
    const provider: AdminOAuthProviderConfig = {
      id: "spotify",
      type: "standard",
      clientId: "c",
      clientSecret: "s",
    };
    const existingShared = existingStandard({ isShared: true, customCallbackUrl: undefined });
    const { envWrite } = splitProviderConfig(provider, existingShared, NEW_CALLBACK);
    expect(envWrite?.["auth.oauth.providers.spotify.customCallbackUrl"]).toBe(NEW_CALLBACK);
  });

  test("provider-specific fields are carried as leaf keys (microsoft tenant, facebook config id)", () => {
    const microsoft: AdminOAuthProviderConfig = {
      id: "microsoft",
      type: "standard",
      clientId: "c",
      clientSecret: "s",
      microsoftTenantId: "tenant-123",
    };
    const { envWrite } = splitProviderConfig(microsoft, undefined, NEW_CALLBACK);
    expect(envWrite?.["auth.oauth.providers.microsoft.microsoftTenantId"]).toBe("tenant-123");
  });

  test("apple bundle ids are encoded as a uuid-keyed record under appleBundles", () => {
    const apple: AdminOAuthProviderConfig = {
      id: "apple",
      type: "standard",
      clientId: "c",
      clientSecret: "s",
      appleBundleIds: ["com.example.app", "com.example.app2"],
    };
    const { envWrite } = splitProviderConfig(apple, undefined, NEW_CALLBACK);
    const bundlesValue = envWrite?.["auth.oauth.providers.apple.appleBundles"];
    // appleBundles is a map of { bundleId }; pull out the ids with runtime checks (no cast).
    const bundleIds: string[] = [];
    if (bundlesValue != null && typeof bundlesValue === "object" && !Array.isArray(bundlesValue)) {
      for (const entry of Object.values(bundlesValue)) {
        if (entry != null && typeof entry === "object" && !Array.isArray(entry) && typeof entry.bundleId === "string") {
          bundleIds.push(entry.bundleId);
        }
      }
    }
    expect(bundleIds.sort()).toEqual(["com.example.app", "com.example.app2"]);
  });
});

describe("envConfigIsWritable", () => {
  test("is false for development environments and true otherwise", () => {
    expect(envConfigIsWritable({ isDevelopmentEnvironment: true })).toBe(false);
    expect(envConfigIsWritable({ isDevelopmentEnvironment: false })).toBe(true);
  });
});
