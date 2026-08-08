import { describe, expect, it } from "vitest";
import { machineConfigForSlot, validateServiceSpec } from "./services.js";
import { computeRevision } from "./revision.js";

function spec(config: Record<string, unknown> = {}) {
  return {
    config: { min_instances: 0, max_instances: 1, port: 5432, ...config },
    source: { image: "registry.fly.io/example@sha256:abc" },
    env: {},
  };
}

describe("service transport", () => {
  it("defaults to HTTP and rejects public TCP", () => {
    expect(validateServiceSpec(spec()).config.transport).toBe("http");
    expect(() => validateServiceSpec(spec({ transport: "tcp", visibility: "public" }))).toThrow(/private/);
    expect(validateServiceSpec(spec({ transport: "tcp", visibility: "private" })).config.transport).toBe("tcp");
  });

  it("configures HTTP handlers and raw TCP ports without exposing both", () => {
    const machine = (transport: "http" | "tcp") => machineConfigForSlot({
      imageRef: "registry.fly.io/example@sha256:abc",
      spec: validateServiceSpec(spec({ transport, visibility: "private" })),
      revision: "revision",
      ns: "namespace",
      key: "service",
      slot: 0,
      env: {},
      volumeId: null,
    });

    expect(machine("http")).toMatchObject({ services: [{
      ports: [{ port: 80, handlers: ["http"] }, { port: 443, handlers: ["tls", "http"] }],
      concurrency: { type: "requests" },
    }] });
    expect(machine("tcp")).toMatchObject({ services: [{
      internal_port: 5432,
      ports: [{ port: 5432 }],
      concurrency: { type: "connections" },
    }] });
  });

  it("rolls the revision when transport changes", () => {
    const key = Buffer.alloc(32, 7);
    expect(computeRevision(validateServiceSpec(spec({ transport: "http" })), key))
      .not.toBe(computeRevision(validateServiceSpec(spec({ transport: "tcp" })), key));
  });
});
