import { describe, expect, it } from "vitest";
import type { MarshalBuild, MarshalServiceState } from "./marshal-client";
import { definitionFromServiceRow, deploymentRunStatusFromMarshal } from "./index";

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
      env: { SAFE: { value: "legacy" } },
    });
    expect(definition.env.SAFE).toEqual({ type: undefined, value: "legacy", key: undefined });
  });
});
