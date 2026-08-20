import { describe, expect, it } from "vitest";
import {
  createErrorIngestPolicyStateStore,
  evaluateErrorIngestPolicy,
  parseErrorIngestPolicyConfig,
  ErrorIngestPolicyConfigError,
  type ErrorIngestPolicyItem,
} from "./error-ingest-policy";

const scope = { tenancyId: "tenancy-1", projectId: "project-1", branchId: "branch-1" };

function items(): readonly ErrorIngestPolicyItem[] {
  return [
    { itemId: "event:0", itemType: "event", data: { user: { email: "foo@example.com" }, url: "https://example.test/path?token=secret" } },
    { itemId: "span:0", itemType: "span", data: { message: "ok" } },
  ];
}

describe("server-side error-ingest policy", () => {
  it("adds only configured final scrubbing and keeps the default boundary", () => {
    const decision = evaluateErrorIngestPolicy({
      config: {
        observability: {
          errorIngest: {
            finalScrub: {
              dropKeys: { dropEmail: "user.email" },
              urlKeys: { pathOnlyUrl: "url" },
            },
          },
        },
      },
      scope,
      items: items().slice(0, 1),
      nowMs: 1_000,
      stateStore: createErrorIngestPolicyStateStore(),
    });

    expect(decision.outcomes[0]).toMatchObject({ status: "accepted", scrubbed: true });
    expect(decision.scrubbedData.get("event:0")).toEqual({ url: "https://example.test/path", user: {} });
  });

  it("rejects unsafe override selectors without echoing configuration values", () => {
    expect(() => parseErrorIngestPolicyConfig({
      observability: { errorIngest: { finalScrub: { dropKeys: { dropAuth: "request.headers.authorization" } } } },
    })).toThrowError(ErrorIngestPolicyConfigError);
    expect(() => parseErrorIngestPolicyConfig({
      observability: { errorIngest: { finalScrub: { dropKeys: { dropAuth: "request.headers.authorization" } } } },
    })).toThrow("Unsupported error-ingest scrub override key");
    expect(() => parseErrorIngestPolicyConfig({
      observability: { errorIngest: { finalScrub: { dropKeys: { "dotted.rule.id": "user.email" } } } },
    })).toThrow("rule ids must be short dotless identifiers");
    expect(() => parseErrorIngestPolicyConfig({
      observability: { errorIngest: { finalScrub: { dropKeys: { nonStringSelector: true } } } },
    })).toThrow("Unsupported error-ingest scrub override key");
    expect(() => parseErrorIngestPolicyConfig({
      observability: { errorIngest: { finalScrub: { dropUrl: { dropRule: "url" } } } },
    })).toThrow("Unsupported finalScrub policy field");
    expect(() => parseErrorIngestPolicyConfig({
      observability: { errorIngest: { unsupported: "raw-value" } },
    })).toThrow("Unsupported error-ingest policy field");
  });

  it("makes deterministic item and byte decisions within aligned windows", () => {
    const store = createErrorIngestPolicyStateStore();
    const config = {
      observability: {
        errorIngest: {
          rateLimit: { maxItemsPerWindow: 1, windowSeconds: 60 },
          quota: { maxBytesPerWindow: 100, windowSeconds: 60 },
        },
      },
    };
    const first = evaluateErrorIngestPolicy({ config, scope, items: items(), nowMs: 1_000, stateStore: store });
    const second = evaluateErrorIngestPolicy({ config, scope, items: [items()[1]], nowMs: 1_001, stateStore: store });

    expect(first.outcomes.map((outcome) => outcome.status)).toEqual(["accepted", "rate_limited"]);
    expect(second.outcomes[0]).toMatchObject({ status: "rate_limited", reason: "rate_limit", retryAfterMs: 58_999 });

    const quota = evaluateErrorIngestPolicy({
      config: { observability: { errorIngest: { quota: { maxBytesPerWindow: 1, windowSeconds: 60 } } } },
      scope: { ...scope, projectId: "project-2" },
      items: [items()[1]],
      nowMs: 1_000,
      stateStore: createErrorIngestPolicyStateStore(),
    });
    expect(quota.outcomes[0]).toMatchObject({ status: "rate_limited", reason: "quota" });
  });

  it("keeps the quota byte counter across rate-limit window rollovers", () => {
    const store = createErrorIngestPolicyStateStore();
    const config = {
      observability: {
        errorIngest: {
          rateLimit: { maxItemsPerWindow: 100, windowSeconds: 1 },
          quota: { maxBytesPerWindow: 40, windowSeconds: 3_600 },
        },
      },
    };
    const item = [items()[1]];

    expect(evaluateErrorIngestPolicy({ config, scope, items: item, nowMs: 0, stateStore: store }).outcomes[0].status).toBe("accepted");
    expect(evaluateErrorIngestPolicy({ config, scope, items: item, nowMs: 500, stateStore: store }).outcomes[0].status).toBe("accepted");
    const rolled = evaluateErrorIngestPolicy({ config, scope, items: item, nowMs: 1_500, stateStore: store });
    expect(rolled.outcomes[0]).toMatchObject({ status: "rate_limited", reason: "quota" });
  });

  it("shares counters only within the exact tenant, project, and branch scope", () => {
    const config = { observability: { errorIngest: { rateLimit: { maxItemsPerWindow: 1, windowSeconds: 60 } } } };
    const store = createErrorIngestPolicyStateStore();
    const item = [items()[1]];

    expect(evaluateErrorIngestPolicy({ config, scope, items: item, nowMs: 1_000, stateStore: store }).outcomes[0].status).toBe("accepted");
    expect(evaluateErrorIngestPolicy({ config, scope, items: item, nowMs: 1_001, stateStore: store }).outcomes[0].status).toBe("rate_limited");
    expect(evaluateErrorIngestPolicy({ config, scope: { ...scope, tenancyId: "tenancy-2" }, items: item, nowMs: 1_001, stateStore: store }).outcomes[0].status).toBe("accepted");
    expect(evaluateErrorIngestPolicy({ config, scope: { ...scope, projectId: "project-2" }, items: item, nowMs: 1_001, stateStore: store }).outcomes[0].status).toBe("accepted");
    expect(evaluateErrorIngestPolicy({ config, scope: { ...scope, branchId: "branch-2" }, items: item, nowMs: 1_001, stateStore: store }).outcomes[0].status).toBe("accepted");

    const firstCollidingScope = { tenancyId: "a:b", projectId: "c", branchId: "d" };
    const secondCollidingScope = { tenancyId: "a", projectId: "b:c", branchId: "d" };
    expect(evaluateErrorIngestPolicy({ config, scope: firstCollidingScope, items: item, nowMs: 1_000, stateStore: store }).outcomes[0].status).toBe("accepted");
    expect(evaluateErrorIngestPolicy({ config, scope: secondCollidingScope, items: item, nowMs: 1_000, stateStore: store }).outcomes[0].status).toBe("accepted");
  });

  it("does not allocate persistent counters when no limits are configured", () => {
    const store = createErrorIngestPolicyStateStore();
    const decision = evaluateErrorIngestPolicy({ config: {}, scope, items: items(), nowMs: 1_000, stateStore: store });
    expect(decision.outcomes.every((outcome) => outcome.status === "accepted")).toBe(true);
    expect(store.buckets.size).toBe(0);
  });

  it("rejects malformed configs and keys outside the declarable policy surface", () => {
    expect(() => parseErrorIngestPolicyConfig(null)).toThrow(ErrorIngestPolicyConfigError);
    expect(() => parseErrorIngestPolicyConfig("not-a-config")).toThrow("observability config must be an object");
    expect(() => parseErrorIngestPolicyConfig({ observability: { errorIngest: { version: 1 } } })).toThrow("Unsupported error-ingest policy field");
  });
});
