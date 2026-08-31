import { describe, expect, it, vi } from "vitest";
import type { PortsConfig } from "./types.js";

// resolveEnv reaches for the stored spec only when the target is NOT part of the
// deployment being applied, so the store is mocked to stand in for "what was
// deployed last time" — which is exactly what must NOT win for an in-flight target.
const readSpec = vi.hoisted(() => vi.fn());
const runtimeAddress = vi.hoisted(() => vi.fn());

vi.mock("./config.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./config.js")>(),
  getConfig: () => ({ envId: "test" }),
}));

vi.mock("./store.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./store.js")>(),
  readSpec,
}));

vi.mock("./gcp/runtime.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./gcp/runtime.js")>(),
  runtimeAddress,
}));

import { resolveEnv } from "./services.js";
import { privateHostnameForService } from "./naming.js";

// Built from the real helper rather than spelled out: app names carry a hash, so
// a literal here would pin this test to the naming scheme instead of the rule.
const dbHost = privateHostnameForService("test", "ns", "db");

const ports = (config: PortsConfig): PortsConfig => config;
const storedSpec = (isPublic: boolean, type: "server" | "serverless" = "server") => ({
  spec: { config: { type, public: isPublic, min_instances: 0, max_instances: 1, ports: ports({ "8080": { protocol: "http" } }) }, source: { image: "img" }, env: {} },
  revision: "stored",
});

describe("url() resolution against a target being changed in the same deploy", () => {
  it("takes visibility from THIS deployment's targets, not the stored spec", async () => {
    // REGRESSION: visibility used to be read from the target's STORED spec while
    // its ports came from the deployment. A service flipped public -> private in
    // this very deploy therefore still read as public until its own apply landed,
    // so a sibling applied first baked in a platform URL that the flip was about
    // to take away — silently, with no blocked ref and no error.
    readSpec.mockResolvedValue(storedSpec(true));
    const resolved = await resolveEnv(
      "ns",
      { DB: { ref: "db.url:8080" } },
      new Map([["db", { type: "server", ports: ports({ "8080": { protocol: "http" } }), public: false }]]),
    );
    expect(resolved).toEqual({ ok: true, env: { DB: `http://${dbHost}:8080` } });
    // The stored spec must not have been consulted at all for an in-flight target.
    expect(readSpec).not.toHaveBeenCalled();
  });

  it("still falls back to the stored spec for a target outside this deploy", async () => {
    // A service of another deployment source is not in `knownTargets`, so its
    // stored spec is the only thing that can answer.
    readSpec.mockResolvedValue(storedSpec(false));
    const resolved = await resolveEnv("ns", { DB: { ref: "db.url:8080" } }, new Map());
    expect(resolved).toEqual({ ok: true, env: { DB: `http://${dbHost}:8080` } });
    expect(readSpec).toHaveBeenCalled();
  });

  it("blocks rather than guessing when nothing knows the target", async () => {
    readSpec.mockResolvedValue(null);
    const resolved = await resolveEnv("ns", { DB: { ref: "db.url:8080" } }, new Map());
    expect(resolved).toEqual({ ok: false, blockedRefs: ["db.url:8080"] });
  });

  it("resolves a persistent server hostname from its deterministic private identity", async () => {
    readSpec.mockResolvedValue(storedSpec(false));
    const resolved = await resolveEnv("ns", { HOST: { ref: "db.hostname" } }, new Map());
    expect(resolved).toEqual({ ok: true, env: { HOST: dbHost } });
  });

  it("uses the deployed Cloud Run URI for private serverless references", async () => {
    readSpec.mockResolvedValue(storedSpec(false, "serverless"));
    runtimeAddress.mockResolvedValue({ hostname: "web-abc.a.run.app", platformUrl: null, internalUrl: "https://web-abc.a.run.app" });
    const resolved = await resolveEnv("ns", {
      HOST: { ref: "db.hostname" },
      URL: { ref: "db.url:8080" },
    }, new Map());
    expect(resolved).toEqual({ ok: true, env: { HOST: "web-abc.a.run.app", URL: "https://web-abc.a.run.app" } });
  });
});
