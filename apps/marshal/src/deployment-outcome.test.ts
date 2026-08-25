import { describe, expect, it } from "vitest";
import { deploymentStateForApply, reportedDigest } from "./services.js";
import type { ServiceState } from "./types.js";

// The image the spec named. Every outcome reports one — including a failure,
// where "which image" is most of the question.
const IMAGE = "registry.fly.io/app@sha256:" + "a".repeat(64);

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
    expect(deploymentStateForApply("web", IMAGE, { revision: "r1", imageRef: null, state: state() })).toEqual({
      service_key: "web",
      status: "deployed",
      revision: "r1",
      url: "https://web.fly.dev",
      image: IMAGE,
      error: null,
    });
    // A private service has no public URL, which is not a failure.
    expect(deploymentStateForApply("web", IMAGE, {
      revision: "r1",
      imageRef: null,
      state: state({ outputs: { hostname: "web.flycast", internal_url: null, url: null } }),
    })).toMatchObject({ status: "deployed", url: null });
  });

  it("records a FAILED apply as failed rather than deployed", () => {
    // REGRESSION: only "blocked" used to be treated as a failure, so this was
    // recorded as "deployed" — and the deployment then reported "succeeded"
    // over a service that never rolled. The apply's error is caught inside
    // applyServiceSpec and stored, so it arrives here through the state and
    // never through the caller's own catch.
    const failed = deploymentStateForApply("web", IMAGE, {
      revision: "r1",
      imageRef: null,
      state: state({ status: "failed", error: "deploy failed: machine never started" }),
    });
    expect(failed).toMatchObject({ status: "failed", url: null, error: "deploy failed: machine never started" });
  });

  it("records a degraded apply that carries an error as failed", () => {
    // Partially rolled and still broken: some machines came up, the apply errored.
    expect(deploymentStateForApply("web", IMAGE, {
      revision: "r1",
      imageRef: null,
      state: state({ status: "degraded", error: "deploy failed: one machine would not start" }),
    })).toMatchObject({ status: "failed", error: "deploy failed: one machine would not start" });
  });

  it("still counts a degraded apply with NO error as deployed", () => {
    // "degraded" also arises from merely under-pinned machines during a scale-up,
    // which carries no error. Failing on the status alone would fail deploys for
    // a transient state that resolves itself.
    expect(deploymentStateForApply("web", IMAGE, { revision: "r1", imageRef: null, state: state({ status: "degraded" }) }))
      .toMatchObject({ status: "deployed", url: "https://web.fly.dev" });
  });

  it("reports the image FLY resolved, not the tag the spec named", () => {
    // Marshal does not resolve images, so a tag stays a tag in the spec and the
    // digest only exists in what Fly reported back for the machine. Recording
    // the tag here would make the deployment history say nothing at all about
    // which bytes ran.
    const ran = "docker.io/library/postgres@sha256:" + "b".repeat(64);
    expect(deploymentStateForApply("db", "docker.io/library/postgres:16", { revision: "r1", imageRef: ran, state: state() }))
      .toMatchObject({ status: "deployed", image: ran });
    // Reported on a failure too, for the same reason every other field is.
    expect(deploymentStateForApply("db", "docker.io/library/postgres:16", {
      revision: "r1",
      imageRef: ran,
      state: state({ status: "failed", error: "deploy failed: machine never started" }),
    })).toMatchObject({ status: "failed", image: ran });
    // An apply that rolled no machine has no resolution to report, so the
    // reference as written is all there is to say.
    expect(deploymentStateForApply("db", "docker.io/library/postgres:16", { revision: "r1", imageRef: null, state: state() }))
      .toMatchObject({ image: "docker.io/library/postgres:16" });
  });

  it("records a blocked apply as failed, and names the reason when the state gives none", () => {
    expect(deploymentStateForApply("web", IMAGE, {
      revision: "r1",
      imageRef: null,
      state: state({ status: "blocked", error: "blocked on unresolved refs: api.url" }),
    })).toMatchObject({ status: "failed", error: "blocked on unresolved refs: api.url" });
    // The fallbacks differ per status so the deployment's own error says which
    // kind of failure it was, even when the state carried no message.
    expect(deploymentStateForApply("web", IMAGE, { revision: "r1", imageRef: null, state: state({ status: "blocked" }) }))
      .toMatchObject({ status: "failed", error: "a connection could not be resolved" });
    expect(deploymentStateForApply("web", IMAGE, { revision: "r1", imageRef: null, state: state({ status: "failed" }) }))
      .toMatchObject({ status: "failed", error: "web failed to deploy" });
  });
});

describe("the digest Fly reports for a machine", () => {
  const machine = (imageRef: unknown) => ({ image_ref: imageRef } as Parameters<typeof reportedDigest>[0]);
  const digest = `sha256:${"c".repeat(64)}`;

  it("is the digest when Fly reports one", () => {
    expect(reportedDigest(machine({ digest }))).toBe(digest);
  });

  it("is null when Fly reports no image_ref, or no digest in it", () => {
    expect(reportedDigest(machine(undefined))).toBeNull();
    expect(reportedDigest(machine({ registry: "docker-hub-mirror.fly.io" }))).toBeNull();
  });

  it("is null for an EMPTY digest, which a null check alone would let through", () => {
    // REGRESSION: `image_ref.digest` is optional and typed as a plain string, so
    // "" is inside its declared type — and `?? null` is nullish-only. It reached
    // pinToDigest and was recorded as `docker.io/library/redis@`: an image
    // reference, stored as what ran, naming nothing.
    expect(reportedDigest(machine({ digest: "" }))).toBeNull();
  });

  it("is null for anything that is not a sha256 digest", () => {
    expect(reportedDigest(machine({ digest: "latest" }))).toBeNull();
    expect(reportedDigest(machine({ digest: "sha256:nothex" }))).toBeNull();
    expect(reportedDigest(machine({ digest: `sha512:${"c".repeat(128)}` }))).toBeNull();
  });
});
