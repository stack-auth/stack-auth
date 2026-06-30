import type { CompleteConfig } from "@hexclave/shared/dist/config/schema";
import { describe, expect, test } from "vitest";
import { buildCustomOidcConfigUpdate, buildProviderConfigUpdate, envConfigIsWritable, type AdminOAuthProviderConfig } from "./provider-config";

const OIDC_CALLBACK = "https://api.hexclave.example/api/v1/auth/oauth/callback/my-oidc";

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

describe("buildProviderConfigUpdate", () => {
  test("shared provider produces a branch-only update with enable fields and no env write", () => {
    const provider: AdminOAuthProviderConfig = { id: "spotify", type: "shared" };
    const { branchUpdate, envWrite } = buildProviderConfigUpdate(provider, undefined, NEW_CALLBACK);

    expect(branchUpdate).toEqual({
      "auth.oauth.providers.spotify": {
        type: "spotify",
        allowSignIn: true,
        allowConnectedAccounts: true,
      },
    });
    expect(envWrite).toBeUndefined();
  });

  test("standard provider produces branch enable fields plus a whole env credential object", () => {
    const provider: AdminOAuthProviderConfig = {
      id: "spotify",
      type: "standard",
      clientId: "client-id",
      clientSecret: "client-secret",
    };
    const { branchUpdate, envWrite } = buildProviderConfigUpdate(provider, undefined, NEW_CALLBACK);

    expect(branchUpdate).toEqual({
      "auth.oauth.providers.spotify": {
        type: "spotify",
        allowSignIn: true,
        allowConnectedAccounts: true,
      },
    });
    // Credentials are written as a whole `auth.oauth.providers.<id>` object; the
    // environment config normalizer flattens it to leaf keys and drops any branch
    // field. Undefined fields are omitted (the hook resets the whole subtree first).
    expect(envWrite).toEqual({
      "auth.oauth.providers.spotify": {
        isShared: false,
        clientId: "client-id",
        clientSecret: "client-secret",
        customCallbackUrl: NEW_CALLBACK,
      },
    });
    const creds = envWrite?.["auth.oauth.providers.spotify"];
    expect(creds).not.toHaveProperty("facebookConfigId");
    expect(creds).not.toHaveProperty("microsoftTenantId");
    expect(creds).not.toHaveProperty("appleBundles");
  });

  test("converting a brand-new standard provider uses the fresh hexclave callback URL", () => {
    const provider: AdminOAuthProviderConfig = {
      id: "spotify",
      type: "standard",
      clientId: "c",
      clientSecret: "s",
    };
    const { envWrite } = buildProviderConfigUpdate(provider, undefined, NEW_CALLBACK);
    expect((envWrite?.["auth.oauth.providers.spotify"] as ConfigProvider).customCallbackUrl).toBe(NEW_CALLBACK);
  });

  test("editing an already-standard provider preserves its existing customCallbackUrl", () => {
    const provider: AdminOAuthProviderConfig = {
      id: "spotify",
      type: "standard",
      clientId: "c",
      clientSecret: "s",
    };
    const existing = existingStandard({ customCallbackUrl: "https://legacy.example/cb" });
    const { envWrite } = buildProviderConfigUpdate(provider, existing, NEW_CALLBACK);
    expect((envWrite?.["auth.oauth.providers.spotify"] as ConfigProvider).customCallbackUrl).toBe("https://legacy.example/cb");
  });

  test("converting shared -> standard uses the fresh callback URL even if a shared 'existing' is passed", () => {
    const provider: AdminOAuthProviderConfig = {
      id: "spotify",
      type: "standard",
      clientId: "c",
      clientSecret: "s",
    };
    const existingShared = existingStandard({ isShared: true, customCallbackUrl: undefined });
    const { envWrite } = buildProviderConfigUpdate(provider, existingShared, NEW_CALLBACK);
    expect((envWrite?.["auth.oauth.providers.spotify"] as ConfigProvider).customCallbackUrl).toBe(NEW_CALLBACK);
  });

  test("provider-specific fields are carried in the env object (microsoft tenant)", () => {
    const microsoft: AdminOAuthProviderConfig = {
      id: "microsoft",
      type: "standard",
      clientId: "c",
      clientSecret: "s",
      microsoftTenantId: "tenant-123",
    };
    const { envWrite } = buildProviderConfigUpdate(microsoft, undefined, NEW_CALLBACK);
    expect((envWrite?.["auth.oauth.providers.microsoft"] as ConfigProvider).microsoftTenantId).toBe("tenant-123");
  });

  test("apple bundle ids are encoded as a uuid-keyed record under appleBundles", () => {
    const apple: AdminOAuthProviderConfig = {
      id: "apple",
      type: "standard",
      clientId: "c",
      clientSecret: "s",
      appleBundleIds: ["com.example.app", "com.example.app2"],
    };
    const { envWrite } = buildProviderConfigUpdate(apple, undefined, NEW_CALLBACK);
    const bundlesValue = (envWrite?.["auth.oauth.providers.apple"] as ConfigProvider).appleBundles;
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

describe("buildCustomOidcConfigUpdate", () => {
  const values = {
    providerId: "my-oidc",
    displayName: "My OIDC",
    issuerUrl: "https://issuer.example",
    clientId: "client-id",
    clientSecret: "client-secret",
    scope: "openid email",
  };

  test("enable fields go to the branch; credentials are a whole env object", () => {
    const { branchUpdate, envWrite } = buildCustomOidcConfigUpdate(values, undefined, OIDC_CALLBACK);

    expect(branchUpdate).toEqual({
      "auth.oauth.providers.my-oidc": {
        type: "custom_oidc",
        allowSignIn: true,
        allowConnectedAccounts: true,
      },
    });
    // OIDC-specific fields (issuerUrl/scope/displayName) live in the env layer; the
    // env normalizer flattens this object to leaf keys.
    expect(envWrite).toEqual({
      "auth.oauth.providers.my-oidc": {
        isShared: false,
        clientId: "client-id",
        clientSecret: "client-secret",
        customCallbackUrl: OIDC_CALLBACK,
        issuerUrl: "https://issuer.example",
        displayName: "My OIDC",
        scope: "openid email",
      },
    });
  });

  test("an omitted scope is not written (cleared by the preceding env reset)", () => {
    const { envWrite } = buildCustomOidcConfigUpdate({ ...values, scope: undefined }, undefined, OIDC_CALLBACK);
    expect(envWrite?.["auth.oauth.providers.my-oidc"]).not.toHaveProperty("scope");
  });

  test("editing an existing provider keeps its already-registered callback URL", () => {
    const existing: ConfigProvider = {
      type: "custom_oidc",
      isShared: false,
      allowSignIn: true,
      allowConnectedAccounts: true,
      clientId: "c",
      clientSecret: "s",
      customCallbackUrl: "https://legacy.example/cb",
      facebookConfigId: undefined,
      microsoftTenantId: undefined,
      appleBundles: undefined,
      issuerUrl: "https://issuer.example",
      displayName: "My OIDC",
    };
    const { envWrite } = buildCustomOidcConfigUpdate(values, existing, OIDC_CALLBACK);
    expect((envWrite?.["auth.oauth.providers.my-oidc"] as ConfigProvider).customCallbackUrl).toBe("https://legacy.example/cb");
  });
});

describe("envConfigIsWritable", () => {
  test("is false for development environments and true otherwise", () => {
    expect(envConfigIsWritable({ isDevelopmentEnvironment: true })).toBe(false);
    expect(envConfigIsWritable({ isDevelopmentEnvironment: false })).toBe(true);
  });
});
