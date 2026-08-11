import { describe, expect, it, vi } from "vitest";
import type { MarshalBuild, MarshalServiceState } from "./marshal-client";
import { assertMinInstancesAllowedByPlan, definitionFromServiceRow, deploymentRunStatusFromMarshal, deploymentStatusFromRuns, marshalSpecForDefinition, redactSecrets } from "./index";
import { getPlanIdForProjectOrNull } from "@/lib/plan-entitlements";

// The gate's own decision logic, isolated from the billing store. Both the sync
// route and the deploy route call this one function, so covering it here covers
// the entitlement boundary at both doors — the deploy-route path in particular
// can't be reached from e2e, since the only way to get a non-compliant STORED
// definition is a downgrade or a row predating the gate, neither of which a
// black-box test can fabricate.
vi.mock("@/lib/plan-entitlements", () => ({ getPlanIdForProjectOrNull: vi.fn() }));

const build: MarshalBuild = {
  id: "01K00000000000000000000000",
  revision: "revision-a",
  status: "succeeded",
  has_logs: true,
  error: null,
  started_at_millis: 1,
  finished_at_millis: 2,
};

function serviceState(overrides: Partial<MarshalServiceState> = {}): MarshalServiceState {
  return {
    key: "api",
    type: "serverless",
    status: "deploying",
    instances: 1,
    revision: "revision-old",
    target_revision: "revision-a",
    outputs: {},
    domains: [],
    error: null,
    observed_at_millis: 3,
    ...overrides,
  };
}

describe("deploymentRunStatusFromMarshal", () => {
  it("keeps a successful build non-terminal until rollout convergence", () => {
    expect(deploymentRunStatusFromMarshal(build, serviceState(), build.revision)).toEqual({ status: "BUILDING", error: null });
  });

  it("marks the run READY only after the target revision is running", () => {
    expect(deploymentRunStatusFromMarshal(build, serviceState({
      status: "running",
      revision: build.revision,
      target_revision: null,
    }), build.revision)).toEqual({ status: "READY", error: null });
  });

  it("surfaces rollout failures and superseded revisions as terminal", () => {
    expect(deploymentRunStatusFromMarshal(build, serviceState({ status: "degraded", error: "machine failed" }), build.revision)).toEqual({
      status: "ERROR",
      error: "machine failed",
    });
    expect(deploymentRunStatusFromMarshal(build, serviceState({ target_revision: "revision-b" }), build.revision)).toEqual({
      status: "CANCELED",
      error: null,
    });
  });
});

describe("stored deployment environment", () => {
  it("preserves __proto__ from the entry-array database representation", () => {
    const definition = definitionFromServiceRow({
      serviceId: "api",
      type: "serverless",
      ports: [{ port: 3000, public: false, transport: "http" }],
      minInstances: 0,
      maxInstances: 1,
      rootDirectory: null,
      dockerfilePath: null,
      volumeId: null,
      volumePath: null,
      volumeSizeGb: null,
      env: [["__proto__", { value: "safe" }]],
    });
    expect(Object.getOwnPropertyDescriptor(definition.env, "__proto__")).toBeDefined();
    expect(definition.env.__proto__).toEqual({ type: undefined, value: "safe", key: undefined });
  });

  it("continues to read the legacy object database representation", () => {
    const definition = definitionFromServiceRow({
      serviceId: "api",
      type: "serverless",
      ports: [{ port: 3000, public: true, transport: "http" }],
      minInstances: 0,
      maxInstances: 1,
      rootDirectory: null,
      dockerfilePath: null,
      volumeId: null,
      volumePath: null,
      volumeSizeGb: null,
      env: { SAFE: { value: "legacy" } },
    });
    expect(definition.env.SAFE).toEqual({ type: undefined, value: "legacy", key: undefined });
    expect(definition.ports).toEqual([{ port: 3000, public: true, transport: "http" }]);
  });
});

describe("stored deployment volumes", () => {
  const baseRow = {
    serviceId: "api",
    type: "server",
    ports: [{ port: 3000, public: false, transport: "http" }],
    minInstances: 0,
    maxInstances: 1,
    rootDirectory: null,
    dockerfilePath: null,
    env: [] as [string, { value: string }][],
  };

  it("reads a stored volume back into the definition under its id", () => {
    const definition = definitionFromServiceRow({ ...baseRow, volumeId: "uploads", volumePath: "/data", volumeSizeGb: 10 });
    expect(definition.persistent_volumes).toEqual({ uploads: { path: "/data", size_gb: 10 } });
  });

  it("reports no volume when the columns are unset", () => {
    const definition = definitionFromServiceRow({ ...baseRow, volumeId: null, volumePath: null, volumeSizeGb: null });
    expect(definition.persistent_volumes).toBeUndefined();
  });

  it("treats a half-written tuple as no volume rather than inventing the missing part", () => {
    // The columns are always written together, so seeing only some means the
    // row is corrupt. Mounting a disk at a guessed path, size, or id would be
    // worse than ignoring it.
    expect(definitionFromServiceRow({ ...baseRow, volumeId: "uploads", volumePath: "/data", volumeSizeGb: null }).persistent_volumes).toBeUndefined();
    expect(definitionFromServiceRow({ ...baseRow, volumeId: "uploads", volumePath: null, volumeSizeGb: 10 }).persistent_volumes).toBeUndefined();
    expect(definitionFromServiceRow({ ...baseRow, volumeId: null, volumePath: "/data", volumeSizeGb: 10 }).persistent_volumes).toBeUndefined();
  });

  it("passes the volume through to the Marshal spec, and omits it entirely when absent", () => {
    const withVolume = marshalSpecForDefinition(
      definitionFromServiceRow({ ...baseRow, volumeId: "uploads", volumePath: "/data", volumeSizeGb: 10 }),
      { image: "registry.fly.io/app@sha256:abc" },
      {},
    );
    expect(withVolume.config).toEqual({
      type: "server",
      min_instances: 0,
      max_instances: 1,
      ports: [{ port: 3000, public: false, transport: "http" }],
      persistent_volumes: { uploads: { path: "/data", size_gb: 10 } },
    });

    const withoutVolume = marshalSpecForDefinition(
      definitionFromServiceRow({ ...baseRow, type: "serverless", volumeId: null, volumePath: null, volumeSizeGb: null }),
      { image: "registry.fly.io/app@sha256:abc" },
      {},
    );
    // Not `persistent_volumes: undefined` — the key must be absent, since Marshal
    // hashes the serialized spec to compute the revision.
    expect("persistent_volumes" in withoutVolume.config).toBe(false);
  });
});

describe("free-plan always-on gate", () => {
  const tenancy = { project: { id: "p1", ownerTeamId: "team1" } } as any;
  const service = (minInstances?: number) => ({
    type: "serverless" as const,
    ports: [{ port: 3000, public: false, transport: "http" as const }],
    ...(minInstances === undefined ? {} : { min_instances: minInstances }),
    env: {},
  });
  const planIs = (planId: string | null) => {
    vi.mocked(getPlanIdForProjectOrNull).mockResolvedValue(planId as any);
  };
  // Also asserts that the call rejected at all — a `.catch()` that silently
  // resolved would otherwise make the message assertions vacuous.
  const rejection = async (promise: Promise<unknown>): Promise<Error> => {
    try {
      await promise;
    } catch (error) {
      return error as Error;
    }
    throw new Error("expected the gate to reject, but it resolved");
  };

  it("rejects always-on services on the free plan and names only the offenders", async () => {
    planIs("free");
    const error = await rejection(assertMinInstancesAllowedByPlan(tenancy, {
      web: service(1),
      worker: service(2),
      idle: service(0),
      unset: service(undefined),
    }));
    // Backticked so the assertion can't be satisfied by the message's own prose.
    expect(error.message).toContain("`web`");
    expect(error.message).toContain("`worker`");
    expect(error.message).not.toContain("`idle`");
    expect(error.message).not.toContain("`unset`");
  });

  it("allows scale-to-zero services on the free plan", async () => {
    planIs("free");
    await expect(assertMinInstancesAllowedByPlan(tenancy, { a: service(0), b: service(undefined) })).resolves.toBeUndefined();
  });

  it("allows always-on services on paid plans", async () => {
    for (const planId of ["team", "growth"]) {
      planIs(planId);
      await expect(assertMinInstancesAllowedByPlan(tenancy, { web: service(3) })).resolves.toBeUndefined();
    }
  });

  it("fails OPEN when the plan cannot be determined", async () => {
    // Null covers plan limits disabled, no billing team, and a billing-store
    // outage. None of them may turn into a refused deploy.
    planIs(null);
    await expect(assertMinInstancesAllowedByPlan(tenancy, { web: service(5) })).resolves.toBeUndefined();
  });

  it("does not consult the plan at all when nothing is offending", async () => {
    planIs("free");
    vi.mocked(getPlanIdForProjectOrNull).mockClear();
    await assertMinInstancesAllowedByPlan(tenancy, { a: service(0) });
    expect(getPlanIdForProjectOrNull).not.toHaveBeenCalled();
  });

  it("caps the listed services so the remedy is not truncated by the CLI", async () => {
    planIs("free");
    const many = Object.fromEntries([...Array(9)].map((_, index) => [`service-number-${index}`, service(1)]));
    const error = await rejection(assertMinInstancesAllowedByPlan(tenancy, many));
    expect(error.message).toContain("and 4 more");
    expect(error.message).toContain("upgrade your plan");
  });
});

describe("deployment status derivation", () => {
  it("stays in progress while the deploy has services it has not started yet", () => {
    // The regression this guards: `hexclave deploy` creates the deployment first
    // and deploys service by service, so reading only the runs called a 3-service
    // deploy "deployed" the moment its first run went READY — then flipped it
    // back to "building" on the next poll.
    expect(deploymentStatusFromRuns(["READY"], 3)).toBe("building");
    expect(deploymentStatusFromRuns([], 3)).toBe("queued");
    expect(deploymentStatusFromRuns(["READY", "READY"], 3)).toBe("building");
    expect(deploymentStatusFromRuns(["READY", "READY", "READY"], 3)).toBe("deployed");
  });

  it("is terminal once something fails, since the rest are skipped", () => {
    // A failed service means its dependents never run at all, so waiting for
    // their runs would leave the deployment building forever.
    expect(deploymentStatusFromRuns(["ERROR"], 3)).toBe("failed");
    expect(deploymentStatusFromRuns(["READY", "CANCELED"], 3)).toBe("canceled");
  });

  it("reports in-flight work ahead of an already-failed run", () => {
    // "Still going" is what decides whether the reader waits.
    expect(deploymentStatusFromRuns(["ERROR", "BUILDING"], 2)).toBe("building");
    expect(deploymentStatusFromRuns(["ERROR", "QUEUED"], 2)).toBe("queued");
  });

  it("is terminal once the client concluded, even with runs that never started", () => {
    // The regression this guards: the CLI creates the deployment BEFORE
    // packaging and upload, and a failure there produces no run at all. With
    // nothing failed to skip the rest, an all-local failure read "queued" and a
    // partial one read "building" — forever, with the dashboard polling both.
    expect(deploymentStatusFromRuns([], 3, true)).toBe("failed");
    expect(deploymentStatusFromRuns(["READY"], 2, true)).toBe("failed");
    // Concluding does not rewrite an outcome the runs already settled.
    expect(deploymentStatusFromRuns(["READY", "READY"], 2, true)).toBe("deployed");
    expect(deploymentStatusFromRuns(["ERROR"], 2, true)).toBe("failed");
    // A run still genuinely in flight outranks the conclusion: the client may
    // have stopped waiting, but the build it already started is still running.
    expect(deploymentStatusFromRuns(["BUILDING"], 2, true)).toBe("building");
    // Unconcluded behaviour is unchanged.
    expect(deploymentStatusFromRuns([], 3, false)).toBe("queued");
    expect(deploymentStatusFromRuns(["READY"], 2, false)).toBe("building");
  });
});

describe("redactSecrets", () => {
  it("redacts a value whose prefix is also a secret", () => {
    // The regression this guards: replacement ran in caller order, so redacting
    // "abc" first destroyed the "abcdef" match and left "def" in the log.
    expect(redactSecrets("token=abcdef", ["abc", "abcdef"])).toBe("token=<redacted>");
    expect(redactSecrets("token=abcdef", ["abcdef", "abc"])).toBe("token=<redacted>");
    // Both still redacted where they appear separately.
    expect(redactSecrets("a=abc b=abcdef", ["abc", "abcdef"])).toBe("a=<redacted> b=<redacted>");
  });

  it("ignores empty values so an empty secret cannot blank the log", () => {
    expect(redactSecrets("hello", ["", "lo"])).toBe("hel<redacted>");
  });
});
