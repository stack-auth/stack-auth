import { describe, expect, it } from "vitest";
import { machineConfigForSlot, soleHttpPort, specIsPublic, validateServiceSpec } from "./services.js";
import { computeRevision } from "./revision.js";

function spec(config: Record<string, unknown> = {}) {
  return {
    config: { type: "serverless", min_instances: 0, max_instances: 1, ports: [{ port: 5432 }], ...config },
    source: { image: "registry.fly.io/example@sha256:abc" },
    env: {},
  };
}

const machineFor = (config: Record<string, unknown>) => machineConfigForSlot({
  imageRef: "registry.fly.io/example@sha256:abc",
  spec: validateServiceSpec(spec(config)),
  revision: "revision",
  ns: "namespace",
  key: "service",
  slot: 0,
  env: {},
  volumeId: null,
});

describe("service ports", () => {
  it("defaults each port to private HTTP", () => {
    expect(validateServiceSpec(spec()).config.ports).toEqual([{ port: 5432, public: false, transport: "http" }]);
    expect(specIsPublic(validateServiceSpec(spec()))).toBe(false);
    expect(specIsPublic(validateServiceSpec(spec({ ports: [{ port: 3000, public: true }] })))).toBe(true);
  });

  it("rejects port sets it could not serve", () => {
    expect(() => validateServiceSpec(spec({ ports: [] }))).toThrow(/at least one port/);
    expect(() => validateServiceSpec(spec({ ports: {} }))).toThrow(/must be an array/);
    expect(() => validateServiceSpec(spec({ ports: [{ port: 0 }] }))).toThrow(/valid port number/);
    expect(() => validateServiceSpec(spec({ ports: [{ port: 3000, public: "yes" }] }))).toThrow(/must be a boolean/);
    expect(() => validateServiceSpec(spec({ ports: [{ port: 3000, transport: "udp" }] }))).toThrow(/must be "http" or "tcp"/);
    expect(() => validateServiceSpec(spec({ ports: [{ port: 3000 }, { port: 3000 }] }))).toThrow(/same port twice/);
    // Raw TCP has no TLS termination or HTTP routing to be public with.
    expect(() => validateServiceSpec(spec({ ports: [{ port: 5432, transport: "tcp", public: true }] }))).toThrow(/private-only/);
    // 80/443 reach one port, so a second public one has nowhere to be served.
    expect(() => validateServiceSpec(spec({ ports: [{ port: 3000, public: true }, { port: 4000, public: true }] })))
      .toThrow(/at most one port public/);
  });

  it("gives each port its own Fly service entry, and the public one 80/443 as well", () => {
    // Private HTTP: reachable at its own number only. This is what makes a
    // SECOND http port addressable at all — 80 can only point at one of them.
    expect(machineFor({ ports: [{ port: 8080 }] })).toMatchObject({
      services: [{
        internal_port: 8080,
        ports: [{ port: 8080, handlers: ["http"] }],
        concurrency: { type: "requests" },
      }],
    });
    // Public HTTP: its own number, plus the standard ports so its fly.dev URL
    // and any custom domain certificate work.
    expect(machineFor({ ports: [{ port: 3000, public: true }] })).toMatchObject({
      services: [{
        internal_port: 3000,
        ports: [
          { port: 3000, handlers: ["http"] },
          { port: 80, handlers: ["http"] },
          { port: 443, handlers: ["tls", "http"] },
        ],
      }],
    });
    // Raw TCP: no handlers, connection-based concurrency.
    expect(machineFor({ ports: [{ port: 5432, transport: "tcp" }] })).toMatchObject({
      services: [{
        internal_port: 5432,
        ports: [{ port: 5432 }],
        concurrency: { type: "connections" },
      }],
    });
  });

  it("emits one service entry per port for a multi-port service", () => {
    const machine = machineFor({
      type: "server",
      ports: [{ port: 3000, public: true }, { port: 5432, transport: "tcp" }, { port: 9090 }],
    });
    const services = machine.services as { internal_port: number, ports: { port: number }[] }[];
    expect(services).toHaveLength(3);
    expect(services.map((service) => service.internal_port)).toEqual([3000, 5432, 9090]);
    // Only the public one is served on the standard ports.
    expect(services.filter((service) => service.ports.some((entry) => entry.port === 443))).toHaveLength(1);
  });

  it("names a port for internal_url only when it is unambiguous", () => {
    expect(soleHttpPort(validateServiceSpec(spec({ ports: [{ port: 8080 }] })).config.ports)).toBe(8080);
    // A TCP sibling does not make the single HTTP port ambiguous.
    expect(soleHttpPort(validateServiceSpec(spec({
      type: "server", ports: [{ port: 8080 }, { port: 5432, transport: "tcp" }],
    })).config.ports)).toBe(8080);
    // Two HTTP ports leave no way to pick one.
    expect(soleHttpPort(validateServiceSpec(spec({ ports: [{ port: 8080 }, { port: 9090 }] })).config.ports)).toBe(null);
    expect(soleHttpPort(validateServiceSpec(spec({ ports: [{ port: 5432, transport: "tcp" }] })).config.ports)).toBe(null);
  });

  it("rolls the revision when any part of the port set changes", () => {
    const key = Buffer.alloc(32, 7);
    const revisionOf = (config: Record<string, unknown>) => computeRevision(validateServiceSpec(spec(config)), key);
    const base = revisionOf({ ports: [{ port: 5432 }] });
    // Each of these changes the machine's Fly services array or its ingress, so
    // none of them may hash identically to the base.
    expect(revisionOf({ ports: [{ port: 5432, transport: "tcp" }] })).not.toBe(base);
    expect(revisionOf({ ports: [{ port: 5432, public: true }] })).not.toBe(base);
    expect(revisionOf({ ports: [{ port: 6000 }] })).not.toBe(base);
    expect(revisionOf({ ports: [{ port: 5432 }, { port: 9090 }] })).not.toBe(base);
    // Same set, restated with its defaults spelled out: identical machines, so
    // the revision must NOT roll (it would restart the fleet for nothing).
    expect(revisionOf({ ports: [{ port: 5432, public: false, transport: "http" }] })).toBe(base);
  });
});
