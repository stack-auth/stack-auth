import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectSecretDefaults, computeDeploymentLevels, evaluateDeploymentConfig, resolveDevEnv, type ServicesFunctionContext } from "./deployment-config.js";

const DEPLOY_FILE_PATH = path.join(path.sep, "repo", "hexclave.deploy.ts");

// Most tests care about the services, not the `deployment` wrapper, so they
// pass the services member alone and this puts it back in the envelope.
function evaluate(servicesExport: unknown, mode: "deploy" | "dev" = "deploy") {
  // Tests pass the services alone; this puts them back in the context-function
  // envelope the real export has.
  const deploymentExport = (context: ServicesFunctionContext) => ({
    services: typeof servicesExport === "function" ? (servicesExport as (ctx: ServicesFunctionContext) => unknown)(context) : servicesExport,
  });
  return evaluateDeploymentConfig({ deployFilePath: DEPLOY_FILE_PATH, idExport: "test-source", deploymentExport, mode });
}

describe("evaluateDeploymentConfig (deploy mode)", () => {
  it("preserves __proto__ as an environment variable instead of mutating the result prototype", () => {
    const { services } = evaluate(() => ({
      web: { type: "serverless", ports: { 3000: {} }, env: { ["__proto__"]: "safe" } },
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
        public: true,
        ports: { 3000: {} },
        minInstances: 1,
        maxInstances: 3,
        devCommand: "pnpm dev",
        rootDirectory: "./apps/web",
        dockerfilePath: "./docker/Dockerfile.web",
        env: {
          DB_URL: (service("database") as any).url(),
          DB_INTERNAL: (service("database") as any).url(5432),
          OPENAI: isDev ? null : secret("OPENAI_API_KEY", "some-default"),
          REQUIRED_SECRET: secret("REQUIRED"),
          PROJECT_ID: (hexclave as any).projectId,
          PLAIN: "literal",
          OMITTED: null,
        },
      },
      database: { type: "serverless", ports: { 5432: {} } },
    }));

    expect([...services.keys()]).toEqual(["frontend", "database"]);
    const frontend = services.get("frontend");
    expect(frontend?.definition).toEqual({
      type: "serverless",
      public: true,
      ports: { "3000": { protocol: "http" } },
      min_instances: 1,
      max_instances: 3,
      root_directory: "apps/web",
      // Normalized to a root-directory-relative posix path.
      dockerfile_path: "docker/Dockerfile.web",
      env: {
        DB_URL: { type: "connection", value: "database.url" },
        DB_INTERNAL: { type: "connection", value: "database.url:5432" },
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

  it("defaults a port to HTTP and a service to private", () => {
    const { services } = evaluate(() => ({ web: { type: "serverless", ports: { 3000: {} } } }));
    // The stored shape is the record the author wrote, with the defaults
    // written out rather than left to each reader.
    expect(services.get("web")?.definition.ports).toEqual({ "3000": { protocol: "http" } });
    expect(services.get("web")?.definition.public).toBe(false);
    const withPublic = evaluate(() => ({ web: { type: "serverless", public: true, ports: { 3000: {} } } }));
    expect(withPublic.services.get("web")?.definition.public).toBe(true);
    // A private service may mix protocols freely.
    const multi = evaluate(() => ({ web: { type: "serverless", ports: { 3000: {}, 9090: { protocol: "tcp" } } } }));
    expect(multi.services.get("web")?.definition.ports).toEqual({
      "3000": { protocol: "http" },
      "9090": { protocol: "tcp" },
    });
  });

  it("rejects port lists it could not serve", () => {
    const evaluatePorts = (ports: unknown) => () => evaluate(() => ({ web: { type: "serverless", ports } }));
    // The FIELD is still required — an omitted `ports` is a forgotten line far
    // more often than a deliberate worker, which writes `ports: {  }`.
    expect(evaluatePorts(undefined)).toThrow("has no `ports`");
    expect(evaluatePorts([{ port: 3000 }])).toThrow("must be an object keyed by port number");
    expect(evaluatePorts({ 3000: { transport: "http" } })).toThrow("unknown field");
    // The KEY is the port number, so a key that is not one is the error.
    expect(evaluatePorts({ web: {} })).toThrow("is not a port number");
    expect(evaluatePorts({ 70000: {} })).toThrow("between 1 and 65535");
    expect(evaluatePorts({ 3000: "public" })).toThrow("must be an object");
    expect(evaluatePorts({ 3000: { public: true } })).toThrow('unknown field "public"');
    expect(evaluatePorts({ 5432: { protocol: "smtp" } })).toThrow('must be "http" or "tcp"');
    // A port numbered 80 or 443 beside the standard-ports holder asks for a
    // listener the holder already claims.
    expect(evaluatePorts({ 8080: {}, 443: { protocol: "tcp" } })).toThrow("additionally answers on the standard 80 and 443");
    // One port, one spelling: "80" and "080" are different keys of one object but
    // the same port, so both would be declared. The record shape only rules out
    // an EXACT repeated key.
    expect(evaluatePorts({ "8080": {}, "08080": {} })).toThrow("leading zero");
    expect(evaluatePorts({ "08080": {} })).toThrow("leading zero");
  });

  it("rejects public services the runtime could not serve", () => {
    const evaluateService = (service: unknown) => () => evaluate(() => ({ web: service }));
    // Several ports on a public service are fine — all of them are reachable.
    expect(evaluateService({ type: "serverless", public: true, ports: { 3000: {}, 4000: {} } })).not.toThrow();
    // ...but not when one is 80 or 443, which the holder already claims.
    expect(evaluateService({ type: "serverless", public: true, ports: { 80: {}, 443: {} } }))
      .toThrow("additionally answers on the standard 80 and 443");
    // The holder itself may be 80 or 443 — it is what owns them.
    expect(evaluateService({ type: "serverless", public: true, ports: { 80: {}, 3000: {} } })).not.toThrow();
    // Raw TCP carries no SNI or Host, so a shared public address cannot route it.
    expect(evaluateService({ type: "server", public: true, ports: { 5432: { protocol: "tcp" } } }))
      .toThrow('declares the "tcp" port');
    // A private service may declare TCP freely.
    expect(evaluateService({ type: "server", ports: { 5432: { protocol: "tcp" } } })).not.toThrow();
    // Public ingress with nothing to serve on it.
    expect(evaluateService({ type: "server", public: true, ports: {} })).toThrow("declares no ports");
    expect(evaluateService({ type: "serverless", public: "yes", ports: { 3000: {} } })).toThrow("must be true or false");
  });

  it("accepts a portless worker", () => {
    // A queue consumer or cron that only dials out. It gets no URL of any kind.
    const { services } = evaluate(() => ({ worker: { type: "server", ports: {  }, env: {} } }));
    expect(services.get("worker")?.definition.ports).toEqual({});
  });

  it("rejects connections whose target ports cannot satisfy them", () => {
    const evaluateEnv = (target: unknown, read: (service: (id: string) => any) => unknown) => () =>
      evaluate(({ service }: ServicesFunctionContext) => ({
        web: { type: "serverless", ports: { 3000: {} }, env: { X: read(service as any) } },
        api: target,
      }));
    const tcpOnly = { type: "server", ports: { 5432: { protocol: "tcp" } } };
    const twoHttp = { type: "serverless", ports: { 8080: {}, 9090: {} } };
    const httpAndTcp = { type: "serverless", ports: { 8080: {}, 5432: { protocol: "tcp" } } };

    // `url` needs something HTTP to serve. A PRIVATE http service is fine —
    // its URL arrives with a verified custom domain.
    expect(evaluateEnv(tcpOnly, (service) => service("api").url())).toThrow("declares only TCP ports");
    expect(evaluateEnv({ type: "serverless", ports: { 8080: {} } }, (service) => service("api").url())).not.toThrow();

    // A bare url() needs exactly one HTTP port to be unambiguous.
    expect(evaluateEnv(twoHttp, (service) => service("api").url())).toThrow("ambiguous");
    // Naming the port resolves it.
    expect(evaluateEnv(twoHttp, (service) => service("api").url(9090))).not.toThrow();
    // A TCP sibling does not make the single HTTP port ambiguous.
    expect(evaluateEnv(httpAndTcp, (service) => service("api").url())).not.toThrow();

    // A named port must exist on the target and speak HTTP.
    expect(evaluateEnv(twoHttp, (service) => service("api").url(1234))).toThrow("does not declare that port");
    expect(evaluateEnv(httpAndTcp, (service) => service("api").url(5432))).toThrow("that port is TCP");
    expect(evaluateEnv(twoHttp, (service) => service("api").url("8080"))).toThrow("takes a port number");

    // There is no port output: a bare number needs no reference.
    expect(evaluateEnv(twoHttp, (service) => service("api").internalPort)).toThrow('has no output named "internalPort"');
    // Forgetting the call is the likely mistake, so it gets its own message.
    expect(evaluateEnv(twoHttp, (service) => service("api").url)).toThrow("without calling it");
    // hostname() names no port, so passing one is a mistake worth its own message.
    expect(evaluateEnv(twoHttp, (service) => service("api").hostname(8080))).toThrow("takes no arguments");
  });

  it("splits public and private work across services", () => {
    // The runtime's proxy listeners are per-app, not per-address, so a service is
    // public on all of its ports or none. Wanting one of each means two services.
    expect(() => evaluate(() => ({
      web: { type: "serverless", public: true, ports: { 3000: {} } },
      metrics: { type: "serverless", ports: { 9090: {}, 5432: { protocol: "tcp" } } },
    }))).not.toThrow();
  });

  it("only makes a deploy dependency of references that need the target deployed", () => {
    // internalHost and internalUrl(<port>) are deterministic — they resolve
    // before the target exists — so they must not order or serialize deploys.
    const deterministicallyWired = () => evaluate(({ service }: ServicesFunctionContext) => ({
      web: {
        type: "serverless", public: true, ports: { 3000: {} },
        env: { API: (service("api") as any).url(8080), DB_HOST: (service("db") as any).hostname() },
      },
      api: { type: "serverless", ports: { 8080: {}, 9090: {} } },
      db: { type: "server", ports: { 5432: { protocol: "tcp" } } },
    }));
    expect(deterministicallyWired).not.toThrow();
    // One level: nothing waits on anything.
    expect(computeDeploymentLevels(deterministicallyWired().services)).toEqual([["web", "api", "db"]]);

    // Mutual wiring through deterministic references is legal, and used to be
    // rejected as a false circular dependency.
    const mutual = () => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: { 3000: {} }, env: { API: (service("api") as any).url() } },
      api: { type: "serverless", ports: { 8080: {} }, env: { WEB_HOST: (service("web") as any).hostname() } },
    }));
    expect(mutual).not.toThrow();
    // `web` still waits on `api`: a bare internalUrl() reads the target's ports.
    expect(computeDeploymentLevels(mutual().services)).toEqual([["api"], ["web"]]);

    // A `url` reference is still a real dependency.
    const publicUrl = evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: { 3000: {} }, env: { API: (service("api") as any).url() } },
      api: { type: "serverless", public: true, ports: { 8080: {} } },
    }));
    expect(computeDeploymentLevels(publicUrl.services)).toEqual([["api"], ["web"]]);
  });

  it("leaves references to services of other deployment sources to the backend", () => {
    // Service ids are unique across the project, so an id this file does not
    // define may well belong to another repository's deploy file. Only the
    // backend can tell that apart from a typo, so nothing is rejected here — and
    // the reference still serializes.
    const { services } = evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: { 3000: {} }, env: { X: (service("elsewhere") as any).url(8080) } },
    }));
    expect(services.get("web")?.definition.env.X).toEqual({ type: "connection", value: "elsewhere.url:8080" });
  });

  it("rejects URL outputs from TCP services and exposes host and port instead", () => {
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: { 3000: {} }, env: { DATABASE_URL: (service("database") as any).url() } },
      database: { type: "serverless", ports: { 5432: { protocol: "tcp" } } },
    }))).toThrow("hostname() with an explicit port");

    const { services } = evaluate(({ service }: ServicesFunctionContext) => ({
      web: {
        type: "serverless",
        ports: { 3000: {} },
        env: {
          DATABASE_HOST: (service("database") as any).hostname(),
          // The port is a literal: the author already wrote 5432 on the target,
          // and a bare number needs no reference to be correct.
          DATABASE_PORT: "5432",
        },
      },
      database: { type: "serverless", ports: { 5432: { protocol: "tcp" } } },
    }));
    expect(services.get("web")?.definition.env).toMatchObject({
      DATABASE_HOST: { type: "connection", value: "database.hostname" },
      DATABASE_PORT: { value: "5432" },
    });
  });

  it("rejects unknown outputs on service() with the available outputs", () => {
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: { 3000: {} }, env: { X: (service("db") as any).ur } },
      db: { type: "serverless", ports: { 3000: {} } },
    }))).toThrow('service("db") has no output named "ur". Available outputs: url, hostname.');
  });

  it("rejects string interpolation of references", () => {
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: { 3000: {} }, env: { API: `${(service("db") as any).url()}/api` } },
      db: { type: "serverless", ports: { 3000: {} } },
    }))).toThrow("cannot be embedded in a string");
    expect(() => evaluate(({ secret }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: { 3000: {} }, env: { AUTH: `Bearer ${secret("KEY", "v")}` } },
    }))).toThrow("cannot be embedded in a string");
    expect(() => evaluate(({ hexclave }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: { 3000: {} }, env: { P: `id-${(hexclave as any).projectId}` } },
    }))).toThrow("cannot be embedded in a string");
  });

  it("rejects unknown outputs on the hexclave context object", () => {
    expect(() => evaluate(({ hexclave }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: { 3000: {} }, env: { X: (hexclave as any).projectid } },
    }))).toThrow('hexclave has no output named "projectid"');
  });

  it("rejects service(\"hexclave\")", () => {
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: { 3000: {} }, env: { X: (service("hexclave") as any).url() } },
    }))).toThrow("use the `hexclave` context object instead");
  });

  it("rejects a self-referential PUBLIC url but allows a private one", () => {
    // The public URL only exists once the service is up, which its own first
    // deploy cannot provide.
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", public: true, ports: { 3000: {} }, env: { SELF: (service("web") as any).url(3000) } },
    }))).toThrow("cannot exist before the service does");
    // A private port's URL is deterministic, so a service may reference its own.
    const { services } = evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: { 3000: {} }, env: { SELF: (service("web") as any).url(3000) } },
    }));
    expect(services.get("web")?.definition.env.SELF).toEqual({ type: "connection", value: "web.url:3000" });
  });

  it("rejects assigning the whole service() return instead of an output", () => {
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: { 3000: {} }, env: { X: service("db") } },
      db: { type: "serverless", ports: { 3000: {} } },
    }))).toThrow("pick one of its outputs");
  });

  it("rejects services without type and with unknown types", () => {
    expect(() => evaluate(() => ({ web: { ports: { 3000: {} } } }))).toThrow('has no `type`');
    expect(() => evaluate(() => ({ web: { type: "netlify" } }))).toThrow('type must be "server" or "serverless"');
  });

  it("rejects unknown service fields (typo protection)", () => {
    expect(() => evaluate(() => ({ web: { type: "serverless", ports: { 3000: {} }, buildCmd: "x" } }))).toThrow('unknown field "buildCmd"');
  });

  it("rejects non-string env values with the value's type", () => {
    expect(() => evaluate(() => ({ web: { type: "serverless", ports: { 3000: {} }, env: { PORT: 3000 } } }))).toThrow("got number");
  });

  it("rejects invalid env var keys and secret keys", () => {
    expect(() => evaluate(() => ({ web: { type: "serverless", ports: { 3000: {} }, env: { "1BAD": "x" } } }))).toThrow("invalid key");
    expect(() => evaluate(({ secret }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: { 3000: {} }, env: { X: secret("bad key") } },
    }))).toThrow("secret key");
  });

  it("rejects a missing services member", () => {
    expect(() => evaluate(undefined)).toThrow("returned no `services`");
  });

  it("rejects empty and non-record returns", () => {
    expect(() => evaluate(() => ({}))).toThrow("returned no services");
    expect(() => evaluate(() => [])).toThrow("must be a record of services keyed by service id");
  });

  it("rejects reserved and invalid service ids", () => {
    expect(() => evaluate(() => ({ hexclave: { type: "serverless", ports: { 3000: {} } } }))).toThrow("reserved");
    expect(() => evaluate(() => ({ "-bad": { type: "serverless", ports: { 3000: {} } } }))).toThrow("Invalid service id");
  });

  it("rejects root directories outside the deploy file's directory", () => {
    expect(() => evaluate(() => ({ web: { type: "serverless", ports: { 3000: {} }, rootDirectory: "../outside" } }))).toThrow("outside the directory containing the deploy file");
  });

  it("omits dockerfile_path when dockerfilePath is not set (Railpack auto-detection)", () => {
    const { services } = evaluate(() => ({ web: { type: "serverless", ports: { 3000: {} } } }));
    expect(services.get("web")?.definition.dockerfile_path).toBeUndefined();
  });

  it("rejects dockerfilePath values escaping the root directory", () => {
    expect(() => evaluate(() => ({
      web: { type: "serverless", ports: { 3000: {} }, dockerfilePath: "../Dockerfile" },
    }))).toThrow("services.web.dockerfilePath must point to a file inside the service's root directory");
    expect(() => evaluate(() => ({
      web: { type: "serverless", ports: { 3000: {} }, dockerfilePath: "." },
    }))).toThrow("services.web.dockerfilePath must point to a file inside the service's root directory");
  });
});

describe("persistent volumes", () => {
  function web(service: Record<string, unknown>) {
    return () => ({ web: { type: "server", ports: { 3000: {} }, env: {}, ...service } });
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
      web: { type: "serverless", ports: { 3000: {} }, maxInstances: 2, persistentVolumes: { data: { path: "/data", sizeGb: 1 } } },
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
      web: { type: "server", ports: { 3000: {} }, persistentVolumes: { shared: { path: "/data", sizeGb: 1 } } },
      worker: { type: "server", ports: { 3001: {} }, persistentVolumes: { shared: { path: "/data", sizeGb: 1 } } },
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
  it("pins a server to a single instance and defaults it to always-on", () => {
    expect(() => evaluate(() => ({ api: { type: "server", ports: { 3000: {} }, maxInstances: 2 } })))
      .toThrow("maxInstances must be 1");
    // 0 (suspend when idle) and 1 (stay up) are the only meanings one instance
    // can have; the default is 1.
    expect(() => evaluate(() => ({ api: { type: "server", ports: { 3000: {} }, minInstances: 2 } })))
      .toThrow("minInstances must be 1 (always on, the default) or 0");
    expect(evaluate(() => ({ api: { type: "server", ports: { 3000: {} }, minInstances: 0 } })).services.get("api")?.definition.min_instances).toBe(0);
    const defaulted = evaluate(() => ({ api: { type: "server", ports: { 3000: {} } } })).services.get("api")?.definition;
    expect(defaulted).toMatchObject({ type: "server", min_instances: 1 });
  });

  it("rejects a fleet larger than the cap, before anything is packaged", () => {
    expect(() => evaluate(() => ({ web: { type: "serverless", ports: { 3000: {} }, maxInstances: 11 } })))
      .toThrow("maxInstances must be between 1 and 10 (got 11)");
    expect(() => evaluate(() => ({ web: { type: "serverless", ports: { 3000: {} }, minInstances: 11 } })))
      .toThrow("minInstances must be between 0 and 10 (got 11)");
    // The cap itself is legal — an off-by-one here would refuse the largest
    // fleet the platform allows.
    expect(evaluate(() => ({ web: { type: "serverless", ports: { 3000: {} }, maxInstances: 10 } })).services.get("web")?.definition.max_instances).toBe(10);
  });

  it("leaves serverless bounds alone", () => {
    const { services } = evaluate(() => ({ web: { type: "serverless", ports: { 3000: {} }, minInstances: 1, maxInstances: 5 } }));
    expect(services.get("web")?.definition).toMatchObject({ type: "serverless", min_instances: 1, max_instances: 5 });
  });

});

describe("the deployment envelope", () => {
  const evaluateExports = (idExport: unknown, deploymentExport: unknown) =>
    () => evaluateDeploymentConfig({ deployFilePath: DEPLOY_FILE_PATH, idExport, deploymentExport, mode: "deploy" });

  it("requires an id export naming the deployment source", () => {
    const deploymentExport = () => ({ services: { web: { type: "serverless", ports: { 3000: {} } } } });
    expect(evaluateExports(undefined, deploymentExport)).toThrow("has no `id` export");
    expect(evaluateExports(7, deploymentExport)).toThrow("must be a string");
    expect(evaluateExports("-nope", deploymentExport)).toThrow("Invalid deployment source id");
    expect(evaluateExports("backend", deploymentExport)().sourceId).toBe("backend");
    // Dots are legal: deployments declared in hexclave.config.ts belong to a
    // source named after the file.
    expect(evaluateExports("hexclave.config.ts", deploymentExport)().sourceId).toBe("hexclave.config.ts");
  });

  it("rejects a missing or malformed deployment export", () => {
    expect(evaluateExports("s", undefined)).toThrow("has no `deployment` export");
    // The context is where secret()/service()/hexclave come from, so a plain
    // object could never reach them.
    expect(evaluateExports("s", { services: {} })).toThrow("must be a function of the deployment context");
    expect(evaluateExports("s", () => ({}))).toThrow("returned no `services`");
    expect(evaluateExports("s", () => ({ services: {}, extra: 1 }))).toThrow('unknown field "extra"');
    expect(evaluateExports("s", () => Promise.resolve({ services: {} }))).toThrow("must be synchronous");
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
        type: "serverless", ports: { 3000: {} },
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
        type: "serverless", ports: { 3000: {} },
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
      web: { type: "serverless", ports: { 3000: {} }, env: { EMPTY: secret("MAYBE", ""), NONE: secret("OTHER") } },
    }));
    expect(collectSecretDefaults(web)).toEqual({ EMPTY: "" });
  });
});

describe("evaluateDeploymentConfig (dev mode)", () => {
  it("resolves secrets to their default value and omits service() connections", () => {
    const { services } = evaluate(({ isDev, secret, service }: ServicesFunctionContext) => ({
      web: {
        type: "serverless", ports: { 3000: {} },
        env: {
          OPENAI: secret("OPENAI_API_KEY", "dev-default"),
          DB_URL: isDev ? null : (service("database") as any).url(),
          PLAIN: "x",
        },
      },
      database: { type: "serverless", ports: { 3000: {} } },
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
      web: { type: "serverless", ports: { 3000: {} }, env: { PLAIN: "x" } },
      worker: { type: "serverless", ports: { 3000: {} }, env: { X: secret("NO_DEFAULT") } },
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
      web: { type: "serverless", ports: { 3000: {} }, env: { X: service("databsae") as never } },
      database: { type: "serverless", ports: { 3000: {} } },
    }), "dev")).not.toThrow();
  });

  it("explains the isDev guard when service() output access crashes on null", () => {
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "serverless", ports: { 3000: {} }, env: { DB_URL: (service("database") as any).url() } },
      database: { type: "serverless", ports: { 3000: {} } },
    }), "dev")).toThrow("service() returns null — guard connection values with isDev");
  });

  it("resolves hexclave outputs from the session env", () => {
    const { services } = evaluate(({ hexclave }: ServicesFunctionContext) => ({
      web: {
        type: "serverless", ports: { 3000: {} },
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
      web: { type: "serverless", ports: { 3000: {} }, env: { SSK: (hexclave as any).secretServerKey } },
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
      frontend: { type: "serverless", ports: { 3000: {} }, env: { A: (service("backend") as any).url(), B: (service("database") as any).url() } },
      backend: { type: "serverless", ports: { 3000: {} }, env: { DB: (service("database") as any).url() } },
      database: { type: "serverless", ports: { 3000: {} } },
      docs: { type: "serverless", ports: { 3000: {} } },
    }));
    expect(computeDeploymentLevels(services)).toEqual([["database", "docs"], ["backend"], ["frontend"]]);
  });

  it("ignores hexclave connections for ordering", () => {
    const services = build(({ hexclave }) => ({
      web: { type: "serverless", ports: { 3000: {} }, env: { P: (hexclave as any).projectId } },
    }));
    expect(computeDeploymentLevels(services)).toEqual([["web"]]);
  });

  it("does not treat a self internalUrl reference as a cycle", () => {
    // A self `internalUrl` is deterministic (see evaluateDeploymentConfig), so it must not
    // create a self-edge that computeDeploymentLevels would report as a false cycle.
    const services = build(({ service }) => ({
      web: { type: "serverless", ports: { 3000: {} }, env: { SELF: (service("web") as any).url(3000) } },
    }));
    expect(computeDeploymentLevels(services)).toEqual([["web"]]);
  });

  it("names the cycle on circular dependencies", () => {
    const services = build(({ service }) => ({
      a: { type: "serverless", ports: { 3000: {} }, env: { X: (service("b") as any).url() } },
      b: { type: "serverless", ports: { 3000: {} }, env: { X: (service("c") as any).url() } },
      c: { type: "serverless", ports: { 3000: {} }, env: { X: (service("a") as any).url() } },
    }));
    expect(() => computeDeploymentLevels(services)).toThrow(/circular connection dependency: (a -> b -> c -> a|b -> c -> a -> b|c -> a -> b -> c)/);
  });
});
