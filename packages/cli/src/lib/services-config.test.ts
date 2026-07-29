import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeDeploymentLevels, evaluateServicesFunction, resolveDevEnv, type ServicesFunctionContext } from "./services-config.js";

const CONFIG_PATH = path.join(path.sep, "repo", "hexclave.config.ts");

function evaluate(servicesExport: unknown, mode: "deploy" | "dev" = "deploy") {
  return evaluateServicesFunction({ configPath: CONFIG_PATH, servicesExport, mode });
}

describe("evaluateServicesFunction (deploy mode)", () => {
  it("serializes a full services export into wire-shape definitions", () => {
    const { services } = evaluate(({ isDev, secret, service, hexclave }: ServicesFunctionContext) => ({
      frontend: {
        type: "vercel",
        framework: "next",
        installCommand: "pnpm install",
        buildCommand: "pnpm build",
        outputDirectory: ".next",
        devCommand: "pnpm dev",
        rootDirectory: "./apps/web",
        env: {
          DB_URL: (service("database") as any).url,
          OPENAI: isDev ? null : secret("OPENAI_API_KEY", "some-default"),
          REQUIRED_SECRET: secret("REQUIRED"),
          PROJECT_ID: (hexclave as any).projectId,
          PLAIN: "literal",
          OMITTED: null,
        },
      },
      database: { type: "vercel" },
    }));

    expect([...services.keys()]).toEqual(["frontend", "database"]);
    const frontend = services.get("frontend");
    expect(frontend?.definition).toEqual({
      type: "vercel",
      framework: "next",
      install_command: "pnpm install",
      build_command: "pnpm build",
      output_directory: ".next",
      dev_command: "pnpm dev",
      root_directory: "apps/web",
      env: {
        DB_URL: { type: "connection", value: "database.url" },
        OPENAI: { type: "secret", key: "OPENAI_API_KEY", default_value: "some-default" },
        REQUIRED_SECRET: { type: "secret", key: "REQUIRED" },
        PROJECT_ID: { type: "connection", value: "hexclave.projectId" },
        PLAIN: { value: "literal" },
      },
    });
    expect(frontend?.absoluteRootDirectory).toBe(path.join(path.sep, "repo", "apps", "web"));
    expect(frontend?.devCommand).toBe("pnpm dev");
    expect(services.get("database")?.definition.root_directory).toBe(".");
  });

  it("rejects service() references to undefined services", () => {
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "vercel", env: { X: (service("databsae") as any).url } },
      database: { type: "vercel" },
    }))).toThrow('service("databsae") does not match any defined service. Available services: web, database.');
  });

  it("rejects unknown outputs on service() with the available outputs", () => {
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "vercel", env: { X: (service("db") as any).ur } },
      db: { type: "vercel" },
    }))).toThrow('service("db") has no output named "ur". Available outputs: url.');
  });

  it("rejects string interpolation of references", () => {
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "vercel", env: { API: `${(service("db") as any).url}/api` } },
      db: { type: "vercel" },
    }))).toThrow("cannot be embedded in a string");
    expect(() => evaluate(({ secret }: ServicesFunctionContext) => ({
      web: { type: "vercel", env: { AUTH: `Bearer ${secret("KEY", "v")}` } },
    }))).toThrow("cannot be embedded in a string");
    expect(() => evaluate(({ hexclave }: ServicesFunctionContext) => ({
      web: { type: "vercel", env: { P: `id-${(hexclave as any).projectId}` } },
    }))).toThrow("cannot be embedded in a string");
  });

  it("rejects an async services function with a clear message", () => {
    expect(() => evaluate(async () => ({ web: { type: "vercel" } }))).toThrow("must be synchronous");
  });

  it("wraps exceptions thrown by include/exclude predicates", () => {
    const { services } = evaluate(() => ({
      web: {
        type: "vercel",
        excludeFiles: () => {
          throw new Error("boom");
        },
      },
    }));
    expect(() => services.get("web")?.excludeFiles?.("a.txt")).toThrow('services.web.excludeFiles threw while filtering "a.txt": boom');
  });

  it("rejects unknown outputs on the hexclave context object", () => {
    expect(() => evaluate(({ hexclave }: ServicesFunctionContext) => ({
      web: { type: "vercel", env: { X: (hexclave as any).projectid } },
    }))).toThrow('hexclave has no output named "projectid"');
  });

  it("rejects service(\"hexclave\")", () => {
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "vercel", env: { X: (service("hexclave") as any).url } },
    }))).toThrow("use the `hexclave` context object instead");
  });

  it("rejects self-referential connections", () => {
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "vercel", env: { SELF: (service("web") as any).url } },
    }))).toThrow("cannot reference itself");
  });

  it("rejects assigning the whole service() return instead of an output", () => {
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "vercel", env: { X: service("db") } },
      db: { type: "vercel" },
    }))).toThrow("pick one of its outputs");
  });

  it("rejects services without type and with unknown types", () => {
    expect(() => evaluate(() => ({ web: { framework: "next" } }))).toThrow('Add `type: "vercel"`');
    expect(() => evaluate(() => ({ web: { type: "netlify" } }))).toThrow('must be "vercel"');
  });

  it("rejects unknown service fields (typo protection)", () => {
    expect(() => evaluate(() => ({ web: { type: "vercel", buildCmd: "x" } }))).toThrow('unknown field "buildCmd"');
  });

  it("rejects non-string env values with the value's type", () => {
    expect(() => evaluate(() => ({ web: { type: "vercel", env: { PORT: 3000 } } }))).toThrow("got number");
  });

  it("rejects invalid env var keys and secret keys", () => {
    expect(() => evaluate(() => ({ web: { type: "vercel", env: { "1BAD": "x" } } }))).toThrow("invalid key");
    expect(() => evaluate(({ secret }: ServicesFunctionContext) => ({
      web: { type: "vercel", env: { X: secret("bad key") } },
    }))).toThrow("secret key");
  });

  it("rejects a missing or non-function services export", () => {
    expect(() => evaluate(undefined)).toThrow("has no `services` export");
    expect(() => evaluate({ web: { type: "vercel" } })).toThrow("must be a function");
  });

  it("rejects empty and non-record returns", () => {
    expect(() => evaluate(() => ({}))).toThrow("returned no services");
    expect(() => evaluate(() => [])).toThrow("must return a record");
  });

  it("rejects reserved and invalid service ids", () => {
    expect(() => evaluate(() => ({ hexclave: { type: "vercel" } }))).toThrow("reserved");
    expect(() => evaluate(() => ({ "-bad": { type: "vercel" } }))).toThrow("Invalid service id");
  });

  it("rejects root directories outside the config directory", () => {
    expect(() => evaluate(() => ({ web: { type: "vercel", rootDirectory: "../outside" } }))).toThrow("outside the directory containing the config file");
  });

  it("wraps predicates so any truthy/falsy return works", () => {
    const { services } = evaluate(() => ({
      web: {
        type: "vercel",
        // Sloppy predicates returning non-booleans must still work.
        includeFiles: (p: string) => p as unknown as boolean,
        excludeFiles: () => 0 as unknown as boolean,
      },
    }));
    expect(services.get("web")?.includeFiles?.("a.txt")).toBe(true);
    expect(services.get("web")?.excludeFiles?.("a.txt")).toBe(false);
  });
});

describe("evaluateServicesFunction (dev mode)", () => {
  it("resolves secrets to their default value and omits service() connections", () => {
    const { services } = evaluate(({ isDev, secret, service }: ServicesFunctionContext) => ({
      web: {
        type: "vercel",
        env: {
          OPENAI: secret("OPENAI_API_KEY", "dev-default"),
          DB_URL: isDev ? null : (service("database") as any).url,
          PLAIN: "x",
        },
      },
      database: { type: "vercel" },
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
      web: { type: "vercel", env: { PLAIN: "x" } },
      worker: { type: "vercel", env: { X: secret("NO_DEFAULT") } },
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
      web: { type: "vercel", env: { X: service("databsae") as never } },
      database: { type: "vercel" },
    }), "dev")).toThrow('service("databsae") does not match any defined service');
  });

  it("explains the isDev guard when service() output access crashes on null", () => {
    expect(() => evaluate(({ service }: ServicesFunctionContext) => ({
      web: { type: "vercel", env: { DB_URL: (service("database") as any).url } },
      database: { type: "vercel" },
    }), "dev")).toThrow("service() returns null — guard connection values with isDev");
  });

  it("resolves hexclave outputs from the session env", () => {
    const { services } = evaluate(({ hexclave }: ServicesFunctionContext) => ({
      web: {
        type: "vercel",
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
      web: { type: "vercel", env: { SSK: (hexclave as any).secretServerKey } },
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
      frontend: { type: "vercel", env: { A: (service("backend") as any).url, B: (service("database") as any).url } },
      backend: { type: "vercel", env: { DB: (service("database") as any).url } },
      database: { type: "vercel" },
      docs: { type: "vercel" },
    }));
    expect(computeDeploymentLevels(services)).toEqual([["database", "docs"], ["backend"], ["frontend"]]);
  });

  it("ignores hexclave connections for ordering", () => {
    const services = build(({ hexclave }) => ({
      web: { type: "vercel", env: { P: (hexclave as any).projectId } },
    }));
    expect(computeDeploymentLevels(services)).toEqual([["web"]]);
  });

  it("names the cycle on circular dependencies", () => {
    const services = build(({ service }) => ({
      a: { type: "vercel", env: { X: (service("b") as any).url } },
      b: { type: "vercel", env: { X: (service("c") as any).url } },
      c: { type: "vercel", env: { X: (service("a") as any).url } },
    }));
    expect(() => computeDeploymentLevels(services)).toThrow(/circular connection dependency: (a -> b -> c -> a|b -> c -> a -> b|c -> a -> b -> c)/);
  });
});
