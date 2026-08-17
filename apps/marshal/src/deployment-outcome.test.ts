import { describe, expect, it } from "vitest";
import { deploymentStateForApply } from "./services.js";
import type { ServiceState } from "./types.js";

function state(overrides: Partial<ServiceState> = {}): ServiceState {
  return {
    key: "web",
    type: "serverless",
    status: "running",
    instances: 1,
    revision: "revision",
    target_revision: null,
    outputs: { hostname: "web.flycast", internal_url: "http://web.flycast:3000", url: "https://web.fly.dev" },
    domains: [],
    error: null,
    observed_at_millis: 0,
    ...overrides,
  };
}

describe("the deployment outcome of one service's apply", () => {
  it("records a converged apply as deployed, with its URL", () => {
    expect(deploymentStateForApply("web", { revision: "r1", state: state() })).toEqual({
      service_key: "web",
      status: "deployed",
      revision: "r1",
      url: "https://web.fly.dev",
      error: null,
    });
    // A private service has no public URL, which is not a failure.
    expect(deploymentStateForApply("web", {
      revision: "r1",
      state: state({ outputs: { hostname: "web.flycast", internal_url: null, url: null } }),
    })).toMatchObject({ status: "deployed", url: null });
  });

  it("records a FAILED apply as failed rather than deployed", () => {
    // REGRESSION: only "blocked" used to be treated as a failure, so this was
    // recorded as "deployed" — and the deployment then reported "succeeded"
    // over a service that never rolled. The apply's error is caught inside
    // applyServiceSpec and stored, so it arrives here through the state and
    // never through the caller's own catch.
    const failed = deploymentStateForApply("web", {
      revision: "r1",
      state: state({ status: "failed", error: "deploy failed: machine never started" }),
    });
    expect(failed).toMatchObject({ status: "failed", url: null, error: "deploy failed: machine never started" });
  });

  it("records a degraded apply that carries an error as failed", () => {
    // Partially rolled and still broken: some machines came up, the apply errored.
    expect(deploymentStateForApply("web", {
      revision: "r1",
      state: state({ status: "degraded", error: "deploy failed: one machine would not start" }),
    })).toMatchObject({ status: "failed", error: "deploy failed: one machine would not start" });
  });

  it("still counts a degraded apply with NO error as deployed", () => {
    // "degraded" also arises from merely under-pinned machines during a scale-up,
    // which carries no error. Failing on the status alone would fail deploys for
    // a transient state that resolves itself.
    expect(deploymentStateForApply("web", { revision: "r1", state: state({ status: "degraded" }) }))
      .toMatchObject({ status: "deployed", url: "https://web.fly.dev" });
  });

  it("records a blocked apply as failed, and names the reason when the state gives none", () => {
    expect(deploymentStateForApply("web", {
      revision: "r1",
      state: state({ status: "blocked", error: "blocked on unresolved refs: api.url" }),
    })).toMatchObject({ status: "failed", error: "blocked on unresolved refs: api.url" });
    // The fallbacks differ per status so the deployment's own error says which
    // kind of failure it was, even when the state carried no message.
    expect(deploymentStateForApply("web", { revision: "r1", state: state({ status: "blocked" }) }))
      .toMatchObject({ status: "failed", error: "a connection could not be resolved" });
    expect(deploymentStateForApply("web", { revision: "r1", state: state({ status: "failed" }) }))
      .toMatchObject({ status: "failed", error: "web failed to deploy" });
  });
});
