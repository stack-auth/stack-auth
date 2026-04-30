// @vitest-environment jsdom

import { StackClientInterface } from "@stackframe/stack-shared";
import type { FeatureFlagEvaluateRequest, FeatureFlagEvaluateResponse } from "@stackframe/stack-shared/dist/interface/crud/feature-flags";
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { Suspense } from "react";
import { createRoot } from "react-dom/client";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

vi.mock("./common", async () => {
  const React = await import("react");
  const { AsyncCache } = await import("@stackframe/stack-shared/dist/utils/caches");
  const { Result } = await import("@stackframe/stack-shared/dist/utils/results");
  const { Store } = await import("@stackframe/stack-shared/dist/utils/stores");

  return {
    clientVersion: "test-client-version",
    createCache: (fetcher: (dependencies: unknown[]) => Promise<unknown>) => {
      return new AsyncCache(
        async (dependencies: unknown[]) => await Result.fromThrowingAsync(async () => await fetcher(dependencies)),
        {},
      );
    },
    createCacheBySession: (fetcher: (session: unknown, extraDependencies: unknown[]) => Promise<unknown>) => {
      return new AsyncCache(
        async ([session, ...extraDependencies]: [unknown, ...unknown[]]) => await Result.fromThrowingAsync(async () => await fetcher(session, extraDependencies)),
        {},
      );
    },
    createEmptyTokenStore: () => new Store({
      accessToken: null,
      refreshToken: null,
    }),
    getAnalyticsBaseUrl: (baseUrl: string) => baseUrl,
    getDefaultExtraRequestHeaders: () => ({}),
    getDefaultProjectId: () => "00000000-0000-4000-8000-000000000000",
    getDefaultPublishableClientKey: () => "pck_test",
    getUrls: () => ({}),
    resolveApiUrls: (baseUrl: string | undefined) => () => [baseUrl ?? "https://api.example.com"],
    resolveConstructorOptions: <T,>(options: T) => options,
    useAsyncCache: (cache: { getOrWait: (dependencies: unknown[], cacheStrategy: "read-write") => Promise<unknown> }, dependencies: unknown[]) => {
      const result = React.use(cache.getOrWait(dependencies, "read-write"));
      if (typeof result === "object" && result !== null && "status" in result) {
        if (result.status === "error" && "error" in result) {
          throw result.error;
        }
        if (result.status === "ok" && "data" in result) {
          return result.data;
        }
      }
      throw new Error("Expected useAsyncCache test mock to receive a Result");
    },
  };
});

import { _StackClientAppImplIncomplete } from "./client-app-impl";

const projectId = "00000000-0000-4000-8000-000000000000";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function waitForElementText(selector: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const text = document.querySelector(selector)?.textContent;
    if (text != null) {
      return text;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

function createInterface(
  evaluateFeatureFlags: (body: FeatureFlagEvaluateRequest) => Promise<FeatureFlagEvaluateResponse>,
) {
  const iface = new StackClientInterface({
    clientVersion: "test-client-version",
    extraRequestHeaders: {},
    getApiUrls: () => ["https://api.example.com/api/v1"],
    getBaseUrl: () => "https://handler.example.com",
    projectId,
    publishableClientKey: "pck_test",
  });
  Object.assign(iface, {
    evaluateFeatureFlags: async (body: FeatureFlagEvaluateRequest) => await evaluateFeatureFlags(body),
  });
  return iface;
}

function createApp(
  evaluateFeatureFlags: (body: FeatureFlagEvaluateRequest) => Promise<FeatureFlagEvaluateResponse>,
) {
  Object.defineProperty(_StackClientAppImplIncomplete.LazyStackAdminAppImpl, "value", {
    value: class TestStackAdminApp {},
    writable: true,
  });
  return new _StackClientAppImplIncomplete({
    baseUrl: "https://api.example.com/api/v1",
    projectId,
    publishableClientKey: "pck_test",
    tokenStore: "memory",
  }, {
    interface: createInterface(evaluateFeatureFlags),
  });
}

describe("StackClientApp feature flag evaluation", () => {
  it("evaluates feature flags through public SDK methods without client-supplied targeting context", async () => {
    const requests: FeatureFlagEvaluateRequest[] = [];
    const app = createApp(async (body) => {
      requests.push(body);
      return {
        results: {
          "new-nav": {
            flag_key: "new-nav",
            variant_key: "enabled",
            value: true,
            reason: "matched_rule",
            rule_id: "rule-1",
          },
          missing: {
            flag_key: "missing",
            variant_key: null,
            reason: "missing",
            rule_id: null,
          },
        },
      };
    });

    await expect(app.getFeatureFlag("new-nav")).resolves.toStrictEqual({
      flagKey: "new-nav",
      variantKey: "enabled",
      value: true,
      reason: "matched_rule",
      ruleId: "rule-1",
    });
    await expect(app.getFeatureFlags(["new-nav", "missing"])).resolves.toStrictEqual({
      "new-nav": {
        flagKey: "new-nav",
        variantKey: "enabled",
        value: true,
        reason: "matched_rule",
        ruleId: "rule-1",
      },
      missing: {
        flagKey: "missing",
        variantKey: null,
        value: undefined,
        reason: "missing",
        ruleId: null,
      },
    });
    expect(requests).toStrictEqual([
      { flag_keys: ["new-nav"] },
      { flag_keys: ["new-nav", "missing"] },
    ]);
  });

  it("fails loudly when the evaluate response omits a requested batch key", async () => {
    const app = createApp(async () => ({
      results: {
        present: {
          flag_key: "present",
          variant_key: null,
          reason: "default",
          rule_id: null,
        },
      },
    }));

    await expect(app.getFeatureFlags(["present", "omitted"])).rejects.toThrow(
      "Feature flag evaluate response did not include requested key omitted",
    );
    await expect(app.getFeatureFlags(["present", "toString"])).rejects.toThrow(
      "Feature flag evaluate response did not include requested key toString",
    );
  });

  it("evaluates feature flags through React-like hooks and caches equivalent ordered batches", async () => {
    const requests: FeatureFlagEvaluateRequest[] = [];
    const app = createApp(async (body) => {
      requests.push(body);
      return {
        results: {
          "new-nav": {
            flag_key: "new-nav",
            variant_key: "enabled",
            value: true,
            reason: "matched_rule",
            rule_id: "rule-1",
          },
        },
      };
    });

    function FeatureFlagProbe() {
      const firstResult = app.useFeatureFlag("new-nav");
      const secondResult = app.useFeatureFlags(["new-nav"]);
      return (
        <output data-testid="feature-flags">
          {JSON.stringify({ firstResult, secondResult })}
        </output>
      );
    }

    const rootElement = document.createElement("div");
    document.body.append(rootElement);
    const root = createRoot(rootElement);
    await React.act(async () => {
      root.render(
        <Suspense fallback={<span>Loading</span>}>
          <FeatureFlagProbe />
        </Suspense>,
      );
    });

    await expect(waitForElementText("[data-testid='feature-flags']")).resolves.toBe(JSON.stringify({
      firstResult: {
        flagKey: "new-nav",
        variantKey: "enabled",
        value: true,
        reason: "matched_rule",
        ruleId: "rule-1",
      },
      secondResult: {
        "new-nav": {
          flagKey: "new-nav",
          variantKey: "enabled",
          value: true,
          reason: "matched_rule",
          ruleId: "rule-1",
        },
      },
    }));
    expect(requests).toStrictEqual([
      { flag_keys: ["new-nav"] },
    ]);
  });
});
