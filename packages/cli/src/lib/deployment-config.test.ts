import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectSecretDefaults, computeDeploymentLevels, evaluateDeploymentConfig, resolveDevEnv, type ServicesFunctionContext } from "./deployment-config.js";

const CONFIG_PATH = path.join(path.sep, "repo", "hexclave.config.ts");

// Most tests care about the services, not the `deployment` wrapper, so they
// pass the services member alone and this puts it back in the envelope.
function evaluate(servicesExport: unknown, mode: "deploy" | "dev" = "deploy") {
  return evaluateDeploymentConfig({ configPath: CONFIG_PATH, deploymentExport: { services: servicesExport }, mode });
}

describe("evaluateDeploymentConfig (deploy mode)", () => {
  it("preserves __proto__ as an environment variable instead of mutating the result prototype", () => {
    const { services } = evaluate(() => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { ["__proto__"]: "safe" } },
    }));
    const definitionEnv = services.get("web")?.definition.env;
    expect(definitionEnv).toBeDefined();
    expect(Object.getOwnPropertyDescriptor(definitionEnv ?? {}, "__proto__")).toBeDefined();
    expect(definitionEnv?.__proto__).toEqual({ value: "safe" });
  });

  it("serializes a full services export into wire-shape definitions", () => {
    const { services } = evaluate(({ isDev, secret, service, hexclave }: ServicesFunctionContext) => ({
      frontend: {
        type: "serverless",
        ports: [{ port: 3000, public: true }],
        minInstances: 1,
        maxInstances: 3,
        devCommand: "pnpm dev",
        rootDirectory: "./apps/web",
        dockerfilePath: "./docker/Dockerfile.web",
        env: {
          DB_URL: (service("database") as any).url,
          DB_INTERNAL: (service("database") as any).internalUrl(),
          OPENAI: isDev ? null : secret("OPENAI_API_KEY", "some-default"),
          REQUIRED_SECRET: secret("REQUIRED"),
          PROJECT_ID: (hexclave as any).projectId,
          PLAIN: "literal",
          OMITTED: null,
        },
      },
      database: { type: "serverless", ports: [{ port: 5432 }] },
    }));

    expect([...services.keys()]).toEqual(["frontend", "database"]);
    const frontend = services.get("frontend");
    expect(frontend?.definition).toEqual({
      type: "serverless",
      ports: [{ port: 3000, public: true, transport: "http" }],
      min_instances: 1,
      max_instances: 3,
      root_directory: "apps/web",
      // Normalized to a root-directory-relative posix path.
      dockerfile_path: "docker/Dockerfile.web",
      env: {
        DB_URL: { type: "connection", value: "database.url" },
        DB_INTERNAL: { type: "connection", value: "database.internalUrl" },
        // No default_value, even though OPENAI is declared with one: defaults
        // are never synced into a definition (see collectSecretDefaults).
        OPENAI: { type: "secret", key: "OPENAI_API_KEY" },
        REQUIRED_SECRET: { type: "secret", key: "REQUIRED" },
        PROJECT_ID: { type: "connection", value: "hexclave.projectId" },
        PLAIN: { value: "literal" },
      },
    });
    expect(frontend?.absoluteRootDirectory).toBe(path.join(path.sep, "repo", "apps", "web"));
    // The dev command is read for local use only — `hexclave dev` gets it from
    // here, and it must never appear in the definition synced above.
    expect(frontend?.devCommand).toBe("pnpm dev");
    expect(frontend?.definition).not.toHaveProperty("dev_command");
    expect(services.get("database")?.definition.root_directory).toBe(".");
  });

  it("defaults every port to private HTTP", () => {
    const { services } = evaluate(() => ({ web: { type: "serverless", ports: [{ port: 3000 }] } }));
    expect(services.get("web")?.definition.ports).toEqual([{ port: 3000, public: false, transport: "http" }]);
    const withPublic = evaluate(() => ({ web: { type: "serverless", ports: [{ port: 3000, public: true }] } }));
    expect(withPublic.services.get("web")?.definition.ports).toEqual([{ port: 3000, public: true, transport: "http" }]);
    // Several ports are fine as long as none is public.
    const multi = evaluate(() => ({ web: { type: "serverless", ports: [{ port: 3000 }, { port: 9090, transport: "tcp" }] } }));
    expect(multi.services.get("web")?.definition.ports).toEqual([
      { port: 3000, public: false, transport: "http" },
      { port: 9090, public: false, transport: "tcp" },
    ]);
  });

  it("rejects port lists it could not serve", () => {
    const evaluatePorts = (ports: unknown) => () => evaluate(() => ({ web: { type: "serverless", ports } }));
    // The FIELD is still required — an omitted `ports` is a forgotten line far
    // more often than a deliberate worker, which writes `ports: []`.
    expect(evaluatePorts(undefined)).toThrow("has no `ports`");
    expect(evaluatePorts({ port: 3000 })).toThrow("must be an array");
    expect(evaluatePorts([{ port: 3000, protocol: "http" }])).toThrow("unknown field");
    expect(evaluatePorts([{ port: "3000" }])).toThrow("must be an integer");
    expect(evaluatePorts([{ port: 70000 }])).toThrow("between 1 and 65535");
    expect(evaluatePorts([{ port: 3000 }, { port: 3000 }])).toThrow("already declared");
    expect(evaluatePorts([{ port: 3000, public: "yes" }])).toThrow("must be true or false");
    expect(evaluatePorts([{ port: 5432, transport: "smtp" }])).toThrow('must be "http" or "tcp"');
    // Raw TCP has no TLS or HTTP routing, so it can never be the public one.
    expect(evaluatePorts([{ port: 5432, transport: "tcp", public: true }])).toThrow("private-only");
    // Several public ports are several ports, so they trip the same rule as a
    // public port with private siblings.
    expect(evaluatePorts([{ port: 3000, public: true }, { port: 4000, public: true }])).toThrow("may not declare any other port");
  });

  it("accepts a portless worker", () => {
    // A queue consumer or cron that only dials out. It gets no URL of any kind.
    const { services } = evaluate(() => ({ worker: { type: "server", ports: [], env: {} } }));
    expect(services.get("worker")?.definition.ports).toEqual([]);
  });

  it("rejects connections whose target ports cannot satisfy them", () => {
    const evaluateEnv = (target: unknown, read: (service: (id: string) => any) => unknown) => () =>
      evaluate(({ service }: ServicesFunctionContext) => ({
        web: { type: "serverless", ports: [{ port: 3000 }], env: { X: read(service as any) } },
        api: target,
      }));
    const tcpOnly = { type: "server", ports: [{ port: 5432, transport: "tcp" }] };
    const twoHttp = { type: "serverless", ports: [{ port: 8080 }, { port: 9090 }] };
    const httpAndTcp = { type: "serverless", ports: [{ port: 8080 }, { port: 5432, transport: "tcp" }] };

    // `url` needs something HTTP to serve. A PRIVATE http service is fine —
    // its URL arrives with a verified custom domain.
    expect(evaluateEnv(tcpOnly, (service) => service("api").url)).toThrow("only TCP ports");
    expect(evaluateEnv({ type: "serverless", ports: [{ port: 8080 }] }, (service) => service("api").url)).not.toThrow();

    // A bare internalUrl() needs exactly one HTTP port to be unambiguous.
    expect(evaluateEnv(tcpOnly, (service) => service("api").internalUrl())).toThrow("declares no HTTP port");
    expect(evaluateEnv(twoHttp, (service) => service("api").internalUrl())).toThrow("ambiguous");
    // Naming the port resolves it.
    expect(evaluateEnv(twoHttp, (service) => service("api").internalUrl(9090))).not.toThrow();
    // A TCP sibling does not make the single HTTP port ambiguous.
    expect(evaluateEnv(httpAndTcp, (service) => service("api").internalUrl())).not.toThrow();

    // A named port must exist on the target and speak HTTP.
    expect(evaluateEnv(twoHttp, (service) => service("api").internalUrl(1234))).toThrow("does not declare that port");
    expect(evaluateEnv(httpAndTcp, (service) => service("api").internalUrl(5432))).toThrow("that port is TCP");
    expect(evaluateEnv(twoHttp, (service) => service("api").internalUrl("8080"))).toThrow("takes a port number");

    // `internalPort` is gone: a bare number needs no reference.
    expect(evaluateEnv(twoHttp, (service) => service("api").internalPort)).toThrow('has no output named "internalPort"');
    // Forgetting the call is the likely mistake, so it gets its own message.
    expect(evaluateEnv(twoHttp, (service) => service("api").internalUrl)).toThrow("without calling it");
  });

  it("rejects a public port that has private siblings", () => {
    // The runtime's proxy listeners are per-app, not per-address, so a private
    // sibling of a public port would be served on the public address too.
    expect(() => evaluate(() => ({
      web: { type: "serverless", ports: [{ port: 3000, public: true }, { port: 9090 }] },
    }))).toThrow("may not declare any other port");
    // Both halves stay legal on their own.
    expect(() => evaluate(() => ({
      web: { type: "serverless", ports: [{ port: 3000, public: true }] },
      metrics: { type: "serverless", ports: [{ port: 9090 }, { port: 5432, transport: "tcp" }] },
    }))).not.toThrow();
  });

  it("only makes a deploy dependency of references that need the target deployed", () => {
    // internalHost and internalUrl(<port>) are deterministic — they resolve
    // before the target exists — so they must not order or serialize deploys.
    const deterministicallyWired = () => evaluate(({ service }: ServicesFunctionContext) => ({
      web: {
        type: "serverless", ports: [{ port: 3000, public: true }],
        env: { API: (service("api") as any).internalUrl(8080), DB_HOST: (service("db") as any).internalHost },
      },
      api: { type: "serverless", ports: [{ port: 8080 }, { port: 9090 }] },
      db: { type: "server", ports: [{ port: 5432, transport: "tcp" }] },
    }));
    expect(deterministicallyWired).not.toThrow();
    // One level: nothing waits on anything.
    expect(computeDeploymentLevels(deterministicallyWired().services)).toEqual([["web", "api", "db"]]);

    // Mutual wiring through deterministic references is legal, and used to be
    // rejected as a false circular dependency.
    const mutual = () => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { API: (service("api") as any).internalUrl() } },
      api: { type: "serverless", ports: [{ port: 8080 }], env: { WEB_HOST: (service("web") as any).internalHost } },
    }));
    expect(mutual).not.toThrow();
    // `web` still waits on `api`: a bare internalUrl() reads the target's ports.
    expect(computeDeploymentLevels(mutual().services)).toEqual([["api"], ["web"]]);

    // A `url` reference is still a real dependency.
    const publicUrl = evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { API: (service("api") as any).url } },
      api: { type: "serverless", ports: [{ port: 8080, public: true }] },
    }));
    expect(computeDeploymentLevels(publicUrl.services)).toEqual([["api"], ["web"]]);
  });

  it("rejects service() references to undefined services", () => {
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { X: (service("databsae") as any).url } },
      database: { type: "serverless", ports: [{ port: 3000 }] },
    }))).toThrow('service("databsae") does not match any defined service. Available services: web, database.');
  });

  it("rejects URL outputs from TCP services and exposes host and port instead", () => {
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { DATABASE_URL: (service("database") as any).internalUrl() } },
      database: { type: "serverless", ports: [{ port: 5432, transport: "tcp" }] },
    }))).toThrow("internalHost with an explicit port");

    const { services } = evaluate(({ service }: ServicesFunctionContext) => ({
      web: {
        type: "serverless",
        ports: [{ port: 3000 }],
        env: {
          DATABASE_HOST: (service("database") as any).internalHost,
          // The port is a literal: the author already wrote 5432 on the target,
          // and a bare number needs no reference to be correct.
          DATABASE_PORT: "5432",
        },
      },
      database: { type: "serverless", ports: [{ port: 5432, transport: "tcp" }] },
    }));
    expect(services.get("web")?.definition.env).toMatchObject({
      DATABASE_HOST: { type: "connection", value: "database.internalHost" },
      DATABASE_PORT: { value: "5432" },
    });
  });

  it("rejects unknown outputs on service() with the available outputs", () => {
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { X: (service("db") as any).ur } },
      db: { type: "serverless", ports: [{ port: 3000 }] },
    }))).toThrow('service("db") has no output named "ur". Available outputs: url, internalUrl, internalHost.');
  });

  it("rejects string interpolation of references", () => {
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { API: `${(service("db") as any).url}/api` } },
      db: { type: "serverless", ports: [{ port: 3000 }] },
    }))).toThrow("cannot be embedded in a string");
    expect(() => evaluate(({ secret }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { AUTH: `Bearer ${secret("KEY", "v")}` } },
    }))).toThrow("cannot be embedded in a string");
    expect(() => evaluate(({ hexclave }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { P: `id-${(hexclave as any).projectId}` } },
    }))).toThrow("cannot be embedded in a string");
  });

  it("rejects an async services function with a clear message", () => {
    expect(() => evaluate(async () => ({ web: { type: "serverless", ports: [{ port: 3000 }] } }))).toThrow("must be synchronous");
  });

  it("rejects unknown outputs on the hexclave context object", () => {
    expect(() => evaluate(({ hexclave }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { X: (hexclave as any).projectid } },
    }))).toThrow('hexclave has no output named "projectid"');
  });

  it("rejects service(\"hexclave\")", () => {
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { X: (service("hexclave") as any).url } },
    }))).toThrow("use the `hexclave` context object instead");
  });

  it("rejects self-referential url connections but allows internal ones", () => {
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { SELF: (service("web") as any).url } },
    }))).toThrow("cannot exist before the service does");
    // The internal address is deterministic, so a service may reference its own.
    const { services } = evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { SELF: (service("web") as any).internalUrl() } },
    }));
    expect(services.get("web")?.definition.env.SELF).toEqual({ type: "connection", value: "web.internalUrl" });
  });

  it("rejects assigning the whole service() return instead of an output", () => {
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { X: service("db") } },
      db: { type: "serverless", ports: [{ port: 3000 }] },
    }))).toThrow("pick one of its outputs");
  });

  it("rejects services without type and with unknown types", () => {
    expect(() => evaluate(() => ({ web: { ports: [{ port: 3000 }] } }))).toThrow('has no `type`');
    expect(() => evaluate(() => ({ web: { type: "netlify" } }))).toThrow('type must be "server" or "serverless"');
  });

  it("rejects unknown service fields (typo protection)", () => {
    expect(() => evaluate(() => ({ web: { type: "serverless", ports: [{ port: 3000 }], buildCmd: "x" } }))).toThrow('unknown field "buildCmd"');
  });

  it("rejects non-string env values with the value's type", () => {
    expect(() => evaluate(() => ({ web: { type: "serverless", ports: [{ port: 3000 }], env: { PORT: 3000 } } }))).toThrow("got number");
  });

  it("rejects invalid env var keys and secret keys", () => {
    expect(() => evaluate(() => ({ web: { type: "serverless", ports: [{ port: 3000 }], env: { "1BAD": "x" } } }))).toThrow("invalid key");
    expect(() => evaluate(({ secret }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { X: secret("bad key") } },
    }))).toThrow("secret key");
  });

  it("rejects a missing services member", () => {
    expect(() => evaluate(undefined)).toThrow("has no `services`");
    // A plain record is no longer an error — it is the context-free spelling.
    // See "the deployment envelope" below for the accepted case.
  });

  it("rejects empty and non-record returns", () => {
    expect(() => evaluate(() => ({}))).toThrow("returned no services");
    expect(() => evaluate(() => [])).toThrow("must be a record of services keyed by service id");
  });

  it("rejects reserved and invalid service ids", () => {
    expect(() => evaluate(() => ({ hexclave: { type: "serverless", ports: [{ port: 3000 }] } }))).toThrow("reserved");
    expect(() => evaluate(() => ({ "-bad": { type: "serverless", ports: [{ port: 3000 }] } }))).toThrow("Invalid service id");
  });

  it("rejects root directories outside the config directory", () => {
    expect(() => evaluate(() => ({ web: { type: "serverless", ports: [{ port: 3000 }], rootDirectory: "../outside" } }))).toThrow("outside the directory containing the config file");
  });

  it("omits dockerfile_path when dockerfilePath is not set (Railpack auto-detection)", () => {
    const { services } = evaluate(() => ({ web: { type: "serverless", ports: [{ port: 3000 }] } }));
    expect(services.get("web")?.definition.dockerfile_path).toBeUndefined();
  });

  it("rejects dockerfilePath values escaping the root directory", () => {
    expect(() => evaluate(() => ({
      web: { type: "serverless", ports: [{ port: 3000 }], dockerfilePath: "../Dockerfile" },
    }))).toThrow("services.web.dockerfilePath must point to a file inside the service's root directory");
    expect(() => evaluate(() => ({
      web: { type: "serverless", ports: [{ port: 3000 }], dockerfilePath: "." },
    }))).toThrow("services.web.dockerfilePath must point to a file inside the service's root directory");
  });
});

describe("persistent volumes", () => {
  function web(service: Record<string, unknown>) {
    return () => ({ web: { type: "server", ports: [{ port: 3000 }], env: {}, ...service } });
  }

  it("serializes a persistent volume into the wire shape, converting sizeGb to size_gb", () => {
    const { services } = evaluate(web({ persistentVolumes: { data: { path: "/data", sizeGb: 10 } } }));
    expect(services.get("web")?.definition.persistent_volumes).toEqual({ data: { path: "/data", size_gb: 10 } });
  });

  it("leaves persistent_volumes absent when none are declared, including for an empty record", () => {
    expect(evaluate(web({})).services.get("web")?.definition.persistent_volumes).toBeUndefined();
    // An empty record must collapse to absent rather than `{}`: the revision is
    // hashed over the serialized definition downstream, so the two spellings
    // would otherwise be different revisions of an identical service.
    expect(evaluate(web({ persistentVolumes: {} })).services.get("web")?.definition.persistent_volumes).toBeUndefined();
  });

  it("allows the implied 0/1 bounds to be spelled out on a server", () => {
    // Scale-to-zero is the point of a server: a suspended machine keeps its
    // volume and Fly Proxy resumes it with the disk intact.
    expect(() => evaluate(web({ minInstances: 0, maxInstances: 1, persistentVolumes: { data: { path: "/data", sizeGb: 1 } } }))).not.toThrow();
  });

  it("rejects a persistent volume on a serverless service", () => {
    expect(() => evaluate(() => ({
      web: { type: "serverless", ports: [{ port: 3000 }], maxInstances: 2, persistentVolumes: { data: { path: "/data", sizeGb: 1 } } },
    }))).toThrow('declares persistentVolumes but is a "serverless" service');
  });

  it("rejects more than one persistent volume per service", () => {
    expect(() => evaluate(web({
      persistentVolumes: { data: { path: "/data", sizeGb: 1 }, cache: { path: "/cache", sizeGb: 1 } },
    }))).toThrow("only 1 per service is supported right now");
  });

  it("rejects the same volume id on two services", () => {
    // One id names one disk; two claimants would be asking Fly to mount it
    // twice, so this has to fail before anything is uploaded.
    expect(() => evaluate(() => ({
      web: { type: "server", ports: [{ port: 3000 }], persistentVolumes: { shared: { path: "/data", sizeGb: 1 } } },
      worker: { type: "server", ports: [{ port: 3001 }], persistentVolumes: { shared: { path: "/data", sizeGb: 1 } } },
    }))).toThrow('The persistent volume id "shared" is claimed by both');
  });

  it("rejects volume ids that cannot become Fly volume names", () => {
    for (const volumeId of ["Data", "1data", "my-volume", "_data", "x".repeat(27)]) {
      expect(() => evaluate(web({ persistentVolumes: { [volumeId]: { path: "/data", sizeGb: 1 } } })), `id ${JSON.stringify(volumeId)}`)
        .toThrow("Invalid persistent volume id");
    }
  });

  it("rejects mount paths that are not normalized absolute paths", () => {
    for (const volumePath of ["data", "/", "/data/", "/data/../etc", "/da\\ta"]) {
      expect(() => evaluate(web({ persistentVolumes: { data: { path: volumePath, sizeGb: 1 } } })), `path ${JSON.stringify(volumePath)}`)
        .toThrow("must be a normalized absolute path inside the container");
    }
  });

  it("rejects sizes outside the supported range and non-integer sizes", () => {
    expect(() => evaluate(web({ persistentVolumes: { data: { path: "/data", sizeGb: 0 } } }))).toThrow("must be between 1 and 500 GB");
    expect(() => evaluate(web({ persistentVolumes: { data: { path: "/data", sizeGb: 501 } } }))).toThrow("must be between 1 and 500 GB");
    expect(() => evaluate(web({ persistentVolumes: { data: { path: "/data", sizeGb: 1.5 } } }))).toThrow("whole number of gigabytes");
  });

  it("rejects a missing path or size, and unknown volume fields", () => {
    expect(() => evaluate(web({ persistentVolumes: { data: { sizeGb: 1 } } }))).toThrow("deployment.services.web.persistentVolumes.data.path is required");
    expect(() => evaluate(web({ persistentVolumes: { data: { path: "/data" } } }))).toThrow("deployment.services.web.persistentVolumes.data.sizeGb is required");
    expect(() => evaluate(web({ persistentVolumes: { data: { path: "/data", sizeGb: 1, size: 2 } } }))).toThrow('unknown field "size"');
    expect(() => evaluate(web({ persistentVolumes: "10gb" }))).toThrow("deployment.services.web.persistentVolumes must be an object");
    expect(() => evaluate(web({ persistentVolumes: { data: "10gb" } }))).toThrow("deployment.services.web.persistentVolumes.data must be an object");
  });
});

describe("service types", () => {
  it("pins a server to a single suspending instance", () => {
    expect(() => evaluate(() => ({ api: { type: "server", ports: [{ port: 3000 }], maxInstances: 2 } })))
      .toThrow("maxInstances must be 1");
    expect(() => evaluate(() => ({ api: { type: "server", ports: [{ port: 3000 }], minInstances: 1 } })))
      .toThrow("minInstances must be 0");
    expect(evaluate(() => ({ api: { type: "server", ports: [{ port: 3000 }] } })).services.get("api")?.definition.type).toBe("server");
  });

  it("leaves serverless bounds alone", () => {
    const { services } = evaluate(() => ({ web: { type: "serverless", ports: [{ port: 3000 }], minInstances: 1, maxInstances: 5 } }));
    expect(services.get("web")?.definition).toMatchObject({ type: "serverless", min_instances: 1, max_instances: 5 });
  });

});

describe("the deployment envelope", () => {
  it("accepts a plain services record with no context function", () => {
    const { services } = evaluateDeploymentConfig({
      configPath: CONFIG_PATH,
      deploymentExport: { services: { web: { type: "serverless", ports: [{ port: 3000 }] } } },
      mode: "deploy",
    });
    expect(services.get("web")?.definition.ports).toEqual([{ port: 3000, public: false, transport: "http" }]);
  });

  it("rejects a missing or malformed deployment export", () => {
    const evaluateExport = (deploymentExport: unknown) =>
      () => evaluateDeploymentConfig({ configPath: CONFIG_PATH, deploymentExport, mode: "deploy" });
    expect(evaluateExport(undefined)).toThrow("has no `deployment` export");
    expect(evaluateExport({})).toThrow("has no `services`");
    expect(evaluateExport({ services: {}, extra: 1 })).toThrow('unknown field "extra"');
    // The pre-`deployment` spelling was a bare function, so say what to do with it.
    expect(evaluateExport(() => ({}))).toThrow("must be an object with a `services` member");
  });
});

describe("collectSecretDefaults", () => {
  function webServiceWithEnv(servicesExport: unknown) {
    const { services } = evaluate(servicesExport);
    const web = services.get("web");
    if (web === undefined) throw new Error("the services export under test must define a service named `web`");
    return web;
  }

  it("collects only secrets that declare a default, keyed by env var", () => {
    const web = webServiceWithEnv(({ secret, hexclave }: ServicesFunctionContext) => ({
      web: {
        type: "serverless", ports: [{ port: 3000 }],
        env: {
          WITH_DEFAULT: secret("OPENAI_API_KEY", "some-default"),
          WITHOUT_DEFAULT: secret("REQUIRED"),
          PLAIN: "literal",
          PROJECT_ID: (hexclave as any).projectId,
        },
      },
    }));
    expect(collectSecretDefaults(web)).toEqual({ WITH_DEFAULT: "some-default" });
  });

  it("keys by env var so one secret can have different defaults per var", () => {
    // The default belongs to the `secret()` CALL, not to the secret — two env
    // vars may fill from the same key with different fallbacks, which a
    // secret-key-keyed map would silently collapse.
    const web = webServiceWithEnv(({ secret }: ServicesFunctionContext) => ({
      web: {
        type: "serverless", ports: [{ port: 3000 }],
        env: {
          PRIMARY: secret("SHARED", "primary-default"),
          SECONDARY: secret("SHARED", "secondary-default"),
        },
      },
    }));
    expect(collectSecretDefaults(web)).toEqual({ PRIMARY: "primary-default", SECONDARY: "secondary-default" });
  });

  it("keeps an empty-string default, which is not the same as having none", () => {
    const web = webServiceWithEnv(({ secret }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { EMPTY: secret("MAYBE", ""), NONE: secret("OTHER") } },
    }));
    expect(collectSecretDefaults(web)).toEqual({ EMPTY: "" });
  });
});

describe("evaluateDeploymentConfig (dev mode)", () => {
  it("resolves secrets to their default value and omits service() connections", () => {
    const { services } = evaluate(({ isDev, secret, service }: ServicesFunctionContext) => ({
      web: {
        type: "serverless", ports: [{ port: 3000 }],
        env: {
          OPENAI: secret("OPENAI_API_KEY", "dev-default"),
          DB_URL: isDev ? null : (service("database") as any).url,
          PLAIN: "x",
        },
      },
      database: { type: "serverless", ports: [{ port: 3000 }] },
    }), "dev");
    expect(resolveDevEnv(services.get("web") ?? (() => {
      throw new Error("web service missing");
    })(), {})).toEqual({
      OPENAI: "dev-default",
      PLAIN: "x",
    });
  });

  it("errors on secrets without a default value only when resolving the selected service", () => {
    // Evaluation itself succeeds — a default-less secret in an UNRELATED
    // service must not block `hexclave dev --service-id` for everything else.
    const { services } = evaluate(({ secret }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { PLAIN: "x" } },
      worker: { type: "serverless", ports: [{ port: 3000 }], env: { X: secret("NO_DEFAULT") } },
    }), "dev");
    expect(resolveDevEnv(services.get("web") ?? (() => {
      throw new Error("web service missing");
    })(), {})).toEqual({ PLAIN: "x" });
    expect(() => resolveDevEnv(services.get("worker") ?? (() => {
      throw new Error("worker service missing");
    })(), {})).toThrow("has no default value, so it cannot be resolved during `hexclave dev`");
  });

  it("validates service() references in dev mode too", () => {
    // service() returns null in dev (the env var is omitted), but a typo'd id
    // must still fail — not lie dormant until the next deploy.
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { X: service("databsae") as never } },
      database: { type: "serverless", ports: [{ port: 3000 }] },
    }), "dev")).toThrow('service("databsae") does not match any defined service');
  });

  it("explains the isDev guard when service() output access crashes on null", () => {
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { DB_URL: (service("database") as any).url } },
      database: { type: "serverless", ports: [{ port: 3000 }] },
    }), "dev")).toThrow("service() returns null — guard connection values with isDev");
  });

  it("resolves hexclave outputs from the session env", () => {
    const { services } = evaluate(({ hexclave }: ServicesFunctionContext) => ({
      web: {
        type: "serverless", ports: [{ port: 3000 }],
        env: {
          PROJECT_ID: (hexclave as any).projectId,
          API_URL: (hexclave as any).apiUrl,
          JWKS: (hexclave as any).jwksUrl,
          PCK: (hexclave as any).publishableClientKey,
          SSK: (hexclave as any).secretServerKey,
        },
      },
    }), "dev");
    const sessionEnv = {
      HEXCLAVE_PROJECT_ID: "proj_123",
      HEXCLAVE_API_URL: "https://api.example.com/",
      HEXCLAVE_PUBLISHABLE_CLIENT_KEY: "pck_123",
      HEXCLAVE_SECRET_SERVER_KEY: "ssk_123",
    };
    expect(resolveDevEnv(services.get("web") ?? (() => {
      throw new Error("web service missing");
    })(), sessionEnv)).toEqual({
      PROJECT_ID: "proj_123",
      API_URL: "https://api.example.com/",
      JWKS: "https://api.example.com/api/v1/projects/proj_123/.well-known/jwks.json",
      PCK: "pck_123",
      SSK: "ssk_123",
    });
  });

  it("errors when the session env lacks a needed hexclave output", () => {
    const { services } = evaluate(({ hexclave }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { SSK: (hexclave as any).secretServerKey } },
    }), "dev");
    expect(() => resolveDevEnv(services.get("web") ?? (() => {
      throw new Error("web service missing");
    })(), {})).toThrow("did not provide HEXCLAVE_SECRET_SERVER_KEY");
  });
});

describe("computeDeploymentLevels", () => {
  const build = (definition: (ctx: ServicesFunctionContext) => unknown) => evaluate(definition as never).services;

  it("orders dependencies before dependents, independent services in one level", () => {
    const services = build(({ service }) => ({
      frontend: { type: "serverless", ports: [{ port: 3000 }], env: { A: (service("backend") as any).url, B: (service("database") as any).url } },
      backend: { type: "serverless", ports: [{ port: 3000 }], env: { DB: (service("database") as any).url } },
      database: { type: "serverless", ports: [{ port: 3000 }] },
      docs: { type: "serverless", ports: [{ port: 3000 }] },
    }));
    expect(computeDeploymentLevels(services)).toEqual([["database", "docs"], ["backend"], ["frontend"]]);
  });

  it("ignores hexclave connections for ordering", () => {
    const services = build(({ hexclave }) => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { P: (hexclave as any).projectId } },
    }));
    expect(computeDeploymentLevels(services)).toEqual([["web"]]);
  });

  it("does not treat a self internalUrl reference as a cycle", () => {
    // A self `internalUrl` is deterministic (see evaluateDeploymentConfig), so it must not
    // create a self-edge that computeDeploymentLevels would report as a false cycle.
    const services = build(({ service }) => ({
      web: { type: "serverless", ports: [{ port: 3000 }], env: { SELF: (service("web") as any).internalUrl() } },
    }));
    expect(computeDeploymentLevels(services)).toEqual([["web"]]);
  });

  it("names the cycle on circular dependencies", () => {
    const services = build(({ service }) => ({
      a: { type: "serverless", ports: [{ port: 3000 }], env: { X: (service("b") as any).url } },
      b: { type: "serverless", ports: [{ port: 3000 }], env: { X: (service("c") as any).url } },
      c: { type: "serverless", ports: [{ port: 3000 }], env: { X: (service("a") as any).url } },
    }));
    expect(() => computeDeploymentLevels(services)).toThrow(/circular connection dependency: (a -> b -> c -> a|b -> c -> a -> b|c -> a -> b -> c)/);
  });
});
