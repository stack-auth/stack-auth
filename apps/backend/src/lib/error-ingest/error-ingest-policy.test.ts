import { describe, expect, it } from "vitest";
import {
  createErrorIngestPolicyStateStore,
  deterministicErrorIngestSamplingDecision,
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
              dropKeys: { "user.email": true },
              urlKeys: { url: true },
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
      observability: { errorIngest: { finalScrub: { dropKeys: { "request.headers.authorization": true } } } },
    })).toThrowError(ErrorIngestPolicyConfigError);
    expect(() => parseErrorIngestPolicyConfig({
      observability: { errorIngest: { finalScrub: { dropKeys: { "request.headers.authorization": true } } } },
    })).toThrow("Unsupported error-ingest scrub override key");
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

  it("shares counters only within the exact tenant, project, and branch scope", () => {
    const config = { observability: { errorIngest: { rateLimit: { maxItemsPerWindow: 1, windowSeconds: 60 } } } };
    const store = createErrorIngestPolicyStateStore();
    const item = [items()[1]];

    expect(evaluateErrorIngestPolicy({ config, scope, items: item, nowMs: 1_000, stateStore: store }).outcomes[0].status).toBe("accepted");
    expect(evaluateErrorIngestPolicy({ config, scope, items: item, nowMs: 1_001, stateStore: store }).outcomes[0].status).toBe("rate_limited");
    expect(evaluateErrorIngestPolicy({ config, scope: { ...scope, tenancyId: "tenancy-2" }, items: item, nowMs: 1_001, stateStore: store }).outcomes[0].status).toBe("accepted");
    expect(evaluateErrorIngestPolicy({ config, scope: { ...scope, projectId: "project-2" }, items: item, nowMs: 1_001, stateStore: store }).outcomes[0].status).toBe("accepted");
    expect(evaluateErrorIngestPolicy({ config, scope: { ...scope, branchId: "branch-2" }, items: item, nowMs: 1_001, stateStore: store }).outcomes[0].status).toBe("accepted");

    // Delimiter-based keys would alias these scopes (`a:b:c:d`), while Relay's
    // typed scoping tuple keeps them independent.
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

  it("applies selector-scoped filters after scrubbing and never returns the raw payload", () => {
    const config = {
      observability: {
        errorIngest: {
          version: 1,
          selectors: { tenancyIds: [scope.tenancyId], projectIds: [scope.projectId], branchIds: [scope.branchId] },
          filters: [{ id: "ignore-health", field: "message", operator: "contains", value: "health check" }],
        },
      },
    };
    const decision = evaluateErrorIngestPolicy({
      config,
      scope,
      items: [{ itemId: "event:0", itemType: "event", data: { message: "health check token=raw-secret", authorization: "Bearer raw-secret" } }],
      nowMs: 1_000,
      stateStore: createErrorIngestPolicyStateStore(),
    });

    expect(decision.outcomes[0]).toMatchObject({ status: "filtered", reason: "configured_filter", filterId: "ignore-health" });
    expect(decision.metadata).toEqual({
      policyVersion: 1,
      normalizationVersion: 1,
      scrubberVersion: 1,
      selectorsMatched: true,
      filterIds: ["ignore-health"],
      sampling: { sampleRate: null, decision: "disabled" },
    });
    expect(JSON.stringify(decision)).not.toContain("raw-secret");
  });

  it("fails closed for a selector miss while retaining built-in secret scrubbing", () => {
    const decision = evaluateErrorIngestPolicy({
      config: {
        observability: {
          errorIngest: {
            selectors: { projectIds: ["another-project"] },
            filters: [{ id: "drop-all", field: "message", operator: "contains", value: "hello" }],
          },
        },
      },
      scope,
      items: [{ itemId: "event:0", itemType: "event", data: { message: "hello", token: "raw-secret" } }],
      nowMs: 1_000,
      stateStore: createErrorIngestPolicyStateStore(),
    });

    expect(decision.outcomes[0]).toMatchObject({ status: "accepted", scrubbed: true });
    expect(decision.scrubbedData.get("event:0")).toEqual({ message: "hello" });
    expect(decision.metadata).toMatchObject({ selectorsMatched: false, filterIds: [], sampling: { sampleRate: null, decision: "disabled" } });
  });

  it("provides deterministic, scope-isolated sampling decisions with boundary rates", () => {
    const input = {
      scope,
      itemId: "event:0",
      itemType: "event" as const,
      seed: "event-id-1",
      seedKind: "event_id" as const,
      sampleRate: 0.5,
    };
    expect(deterministicErrorIngestSamplingDecision(input)).toEqual(deterministicErrorIngestSamplingDecision(input));
    expect(deterministicErrorIngestSamplingDecision({ ...input, scope: { ...scope, tenancyId: "tenancy-2" } })).not.toEqual(
      deterministicErrorIngestSamplingDecision({ ...input, sampleRate: 0 }),
    );
    expect(deterministicErrorIngestSamplingDecision({ ...input, sampleRate: 0 })).toMatchObject({ decision: "drop", sampleRate: 0 });
    expect(deterministicErrorIngestSamplingDecision({ ...input, sampleRate: 1 })).toMatchObject({ decision: "keep", sampleRate: 1 });

    const decision = evaluateErrorIngestPolicy({
      config: { observability: { errorIngest: { sampling: { sampleRate: 0, seed: "event_id" } } } },
      scope,
      items: [{ itemId: "event:0", itemType: "event", data: { event_id: "event-id-1", message: "safe" } }],
      nowMs: 1_000,
      stateStore: createErrorIngestPolicyStateStore(),
    });
    expect(decision.outcomes[0]).toMatchObject({ status: "filtered", reason: "sampling", sampling: { decision: "drop", sampleRate: 0, seedKind: "event_id" } });
    expect(decision.metadata.sampling).toEqual({ sampleRate: 0, decision: "drop", seedKind: "event_id" });
  });

  it("rejects unsupported policy versions, unbounded selectors, and unsafe filter fields", () => {
    expect(() => parseErrorIngestPolicyConfig(null)).toThrow(ErrorIngestPolicyConfigError);
    expect(() => parseErrorIngestPolicyConfig("not-a-config")).toThrow("observability config must be an object");
    expect(() => parseErrorIngestPolicyConfig({ observability: { errorIngest: { version: 2 } } })).toThrow("Unsupported error-ingest policy version");
    expect(() => parseErrorIngestPolicyConfig({ observability: { errorIngest: { selectors: { branchIds: ["branch with spaces"] } } } })).toThrow("unsupported selector");
    expect(() => parseErrorIngestPolicyConfig({ observability: { errorIngest: { filters: [{ id: "secret", field: "request.body", operator: "contains", value: "x" }] } } })).toThrow("unsupported field");
  });
});
