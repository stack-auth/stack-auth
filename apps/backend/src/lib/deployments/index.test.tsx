import { describe, expect, it, vi } from "vitest";
import type { MarshalBuild, MarshalServiceState } from "./marshal-client";
import { assertMinInstancesAllowedByPlan, definitionFromServiceRow, deploymentRunStatusFromMarshal, marshalSpecForDefinition } from "./index";
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
    type: "container",
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
      port: 3000,
      minInstances: 0,
      maxInstances: 1,
      rootDirectory: null,
      dockerfilePath: null,
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
      port: 3000,
      minInstances: 0,
      maxInstances: 1,
      rootDirectory: null,
      dockerfilePath: null,
      volumePath: null,
      volumeSizeGb: null,
      env: { SAFE: { value: "legacy" } },
    });
    expect(definition.env.SAFE).toEqual({ type: undefined, value: "legacy", key: undefined });
  });
});

describe("stored deployment volumes", () => {
  const baseRow = {
    serviceId: "api",
    port: 3000,
    minInstances: 0,
    maxInstances: 1,
    rootDirectory: null,
    dockerfilePath: null,
    env: [] as [string, { value: string }][],
  };

  it("reads a stored volume back into the definition", () => {
    const definition = definitionFromServiceRow({ ...baseRow, volumePath: "/data", volumeSizeGb: 10 });
    expect(definition.volume).toEqual({ path: "/data", size_gb: 10 });
  });

  it("reports no volume when the columns are unset", () => {
    const definition = definitionFromServiceRow({ ...baseRow, volumePath: null, volumeSizeGb: null });
    expect(definition.volume).toBeUndefined();
  });

  it("treats a half-written pair as no volume rather than inventing the missing half", () => {
    // The two columns are always written together, so seeing only one means the
    // row is corrupt. Mounting a disk at a guessed path (or at a guessed size)
    // would be worse than ignoring it.
    expect(definitionFromServiceRow({ ...baseRow, volumePath: "/data", volumeSizeGb: null }).volume).toBeUndefined();
    expect(definitionFromServiceRow({ ...baseRow, volumePath: null, volumeSizeGb: 10 }).volume).toBeUndefined();
  });

  it("passes the volume through to the Marshal spec, and omits it entirely when absent", () => {
    const withVolume = marshalSpecForDefinition(
      definitionFromServiceRow({ ...baseRow, minInstances: 1, maxInstances: 1, volumePath: "/data", volumeSizeGb: 10 }),
      { image: "registry.fly.io/app@sha256:abc" },
      {},
    );
    expect(withVolume.config).toEqual({ min_instances: 1, max_instances: 1, port: 3000, volume: { path: "/data", size_gb: 10 } });

    const withoutVolume = marshalSpecForDefinition(
      definitionFromServiceRow({ ...baseRow, volumePath: null, volumeSizeGb: null }),
      { image: "registry.fly.io/app@sha256:abc" },
      {},
    );
    // Not `volume: undefined` — the key must be absent, since Marshal hashes the
    // serialized spec to compute the revision.
    expect("volume" in withoutVolume.config).toBe(false);
  });
});

describe("free-plan always-on gate", () => {
  const tenancy = { project: { id: "p1", ownerTeamId: "team1" } } as any;
  const service = (minInstances?: number) => ({
    type: "container" as const,
    port: 3000,
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
