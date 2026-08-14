import { describe, expect, it } from "vitest";
import { machineConfigForSlot, soleHttpPort, specIsPublic, validateServiceSpec } from "./services.js";
import { computeRevision } from "./revision.js";

function spec(config: Record<string, unknown> = {}) {
  return {
    config: { type: "serverless", min_instances: 0, max_instances: 1, ports: { "5432": {} }, ...config },
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
    expect(validateServiceSpec(spec()).config.ports).toEqual({ "5432": { public: false, protocol: "http" } });
    expect(specIsPublic(validateServiceSpec(spec()))).toBe(false);
    expect(specIsPublic(validateServiceSpec(spec({ ports: { "3000": { public: true } } })))).toBe(true);
  });

  it("accepts a portless worker and gives it no Fly services entries", () => {
    expect(validateServiceSpec(spec({ ports: {} })).config.ports).toEqual({});
    expect(specIsPublic(validateServiceSpec(spec({ ports: {} })))).toBe(false);
    expect(machineFor({ ports: {} }).services).toEqual([]);
  });

  it("rejects port sets it could not serve", () => {
    expect(() => validateServiceSpec(spec({ ports: [] }))).toThrow(/must be an object keyed by port number/);
    expect(() => validateServiceSpec(spec({ ports: { "0": {} } }))).toThrow(/must be a port number between 1 and 65535/);
    expect(() => validateServiceSpec(spec({ ports: { web: {} } }))).toThrow(/must be a port number between 1 and 65535/);
    expect(() => validateServiceSpec(spec({ ports: { "3000": { public: "yes" } } }))).toThrow(/must be a boolean/);
    expect(() => validateServiceSpec(spec({ ports: { "3000": { protocol: "udp" } } }))).toThrow(/must be "http" or "tcp"/);
    // A duplicate port needs no rule: an object cannot hold one key twice, which
    // is half of why the ports are a record.
    // Raw TCP has no TLS termination or HTTP routing to be public with.
    expect(() => validateServiceSpec(spec({ ports: { "5432": { protocol: "tcp", public: true } } }))).toThrow(/private-only/);
    // Several public ports are ACCEPTED: nothing leaks when every declared port
    // is one the caller asked to publish.
    expect(() => validateServiceSpec(spec({ ports: { "3000": { public: true }, "4000": { public: true } } })))
      .not.toThrow();
    // Fly's proxy listeners are per-app, not per-address: a private sibling of a
    // public port would answer on the public IP too.
    expect(() => validateServiceSpec(spec({ ports: { "3000": { public: true }, "9090": {} } })))
      .toThrow(/may not mix public and private ports/);
  });

  it("gives 80/443 to the lowest public port, by number and not by key order", () => {
    // Determinism is the point: every other public port answers only on its own
    // number, and a shared IPv4 forwards nothing but 80/443 — so an arbitrary
    // pick would silently move which URL works from an IPv4-only client.
    const services = machineFor({ ports: { "8443": { public: true }, "443": { public: true } } }).services as { ports: { port: number }[], internal_port: number }[];
    const holder = services.find((service) => service.internal_port === 443);
    const other = services.find((service) => service.internal_port === 8443);
    expect(holder?.ports.map((entry) => entry.port).sort((a, b) => a - b)).toEqual([80, 443]);
    expect(other?.ports.map((entry) => entry.port)).toEqual([8443]);
  });

  it("terminates TLS on a public port's own number, but not on a private one's", () => {
    // VERIFIED AGAINST REAL FLY: a non-holder public port is reachable ONLY on
    // its own number, so a plain `http` handler there publishes it in cleartext
    // while the URL we report for it says https. A private port is the opposite
    // case — it is reached over Flycast as http://<host>:<port>, and TLS there
    // would break every private url().
    const publicPorts = machineFor({ ports: { "3000": { public: true }, "8443": { public: true } } }).services as { ports: { port: number, handlers?: string[] }[], internal_port: number }[];
    expect(publicPorts.find((service) => service.internal_port === 8443)?.ports)
      .toEqual([{ port: 8443, handlers: ["tls", "http"] }]);
    // The holder keeps plain 80 alongside TLS 443, and its own number is public
    // too, so it terminates TLS as well.
    const holder = publicPorts.find((service) => service.internal_port === 3000)?.ports ?? [];
    expect(holder).toContainEqual({ port: 80, handlers: ["http"] });
    expect(holder).toContainEqual({ port: 443, handlers: ["tls", "http"] });
    expect(holder).toContainEqual({ port: 3000, handlers: ["tls", "http"] });

    const privatePorts = machineFor({ ports: { "8080": {}, "9090": {} } }).services as { ports: { port: number, handlers?: string[] }[], internal_port: number }[];
    expect(privatePorts.find((service) => service.internal_port === 9090)?.ports)
      .toEqual([{ port: 9090, handlers: ["http"] }]);
  });

  it("never binds the same external port twice, even when the container listens on 80 or 443", () => {
    // The most common Docker default: a web image listening on 80, published.
    // Its own binding and the standard-port binding are the same number.
    const onPort80 = machineFor({ ports: { "80": { public: true } } });
    expect((onPort80.services as any[])[0].ports).toEqual([
      { port: 80, handlers: ["http"] },
      { port: 443, handlers: ["tls", "http"] },
    ]);
    // 443 is the dangerous one: its own plain-http binding must not shadow the
    // TLS-terminating one, or the platform URL would serve cleartext.
    const onPort443 = machineFor({ ports: { "443": { public: true } } });
    expect((onPort443.services as any[])[0].ports).toEqual([
      { port: 443, handlers: ["tls", "http"] },
      { port: 80, handlers: ["http"] },
    ]);
    for (const machine of [onPort80, onPort443]) {
      const bound = (machine.services as any[]).flatMap((service) => service.ports.map((entry: any) => entry.port));
      expect(new Set(bound).size).toBe(bound.length);
    }
  });

  it("gives each port its own Fly service entry, and the public one 80/443 as well", () => {
    // A PRIVATE service's sole HTTP port still binds 80/443: attaching a custom
    // domain allocates public IPs and terminates TLS on 443, so without this its
    // verified domain would resolve and then refuse the connection.
    expect(machineFor({ ports: { "8080": {} } })).toMatchObject({
      services: [{
        internal_port: 8080,
        ports: [
          { port: 8080, handlers: ["http"] },
          { port: 80, handlers: ["http"] },
          { port: 443, handlers: ["tls", "http"] },
        ],
        concurrency: { type: "requests" },
      }],
    });
    // Public HTTP: its own number — terminating TLS, because it is public and
    // reachable from the internet there — plus the standard ports so its fly.dev
    // URL and any custom domain certificate work.
    expect(machineFor({ ports: { "3000": { public: true } } })).toMatchObject({
      services: [{
        internal_port: 3000,
        ports: [
          { port: 3000, handlers: ["tls", "http"] },
          { port: 80, handlers: ["http"] },
          { port: 443, handlers: ["tls", "http"] },
        ],
      }],
    });
    // Raw TCP: no handlers, connection-based concurrency.
    expect(machineFor({ ports: { "5432": { protocol: "tcp" } } })).toMatchObject({
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
      ports: { "3000": {}, "5432": { protocol: "tcp" }, "9090": {} },
    });
    const services = machine.services as { internal_port: number, ports: { port: number }[] }[];
    expect(services).toHaveLength(3);
    expect(services.map((service) => service.internal_port)).toEqual([3000, 5432, 9090]);
    // With two HTTP ports there is no single obvious holder, so NOTHING binds
    // the standard ports — which is also why a custom domain is refused here.
    expect(services.filter((service) => service.ports.some((entry) => entry.port === 443))).toHaveLength(0);
  });

  it("names a port for internal_url only when it is unambiguous", () => {
    expect(soleHttpPort(validateServiceSpec(spec({ ports: { "8080": {} } })).config.ports)).toBe(8080);
    // A TCP sibling does not make the single HTTP port ambiguous.
    expect(soleHttpPort(validateServiceSpec(spec({
      type: "server", ports: { "8080": {}, "5432": { protocol: "tcp" } },
    })).config.ports)).toBe(8080);
    // Two HTTP ports leave no way to pick one.
    expect(soleHttpPort(validateServiceSpec(spec({ ports: { "8080": {}, "9090": {} } })).config.ports)).toBe(null);
    expect(soleHttpPort(validateServiceSpec(spec({ ports: { "5432": { protocol: "tcp" } } })).config.ports)).toBe(null);
  });

  it("rolls the revision when any part of the port set changes", () => {
    const key = Buffer.alloc(32, 7);
    const revisionOf = (config: Record<string, unknown>) => computeRevision(validateServiceSpec(spec(config)), key);
    const base = revisionOf({ ports: { "5432": {} } });
    // Each of these changes the machine's Fly services array or its ingress, so
    // none of them may hash identically to the base.
    expect(revisionOf({ ports: { "5432": { protocol: "tcp" } } })).not.toBe(base);
    expect(revisionOf({ ports: { "5432": { public: true } } })).not.toBe(base);
    expect(revisionOf({ ports: { "6000": {} } })).not.toBe(base);
    expect(revisionOf({ ports: { "5432": {}, "9090": {} } })).not.toBe(base);
    // Same set, restated with its defaults spelled out: identical machines, so
    // the revision must NOT roll (it would restart the fleet for nothing).
    expect(revisionOf({ ports: { "5432": { public: false, protocol: "http" } } })).toBe(base);
    // Nor may merely REORDERING the list roll it — same machines, and for a
    // volume-backed server a needless roll is real downtime.
    expect(revisionOf({ ports: { "9090": {}, "5432": {} } }))
      .toBe(revisionOf({ ports: { "5432": {}, "9090": {} } }));
  });
});
