import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertSecretsMatchEnv, extractServiceDefinition, parseSecretOptions, resolveDeployConfigPath, type ServiceEnvVarConfig } from "./deploy.js";

describe("parseSecretOptions", () => {
  it("parses KEY=VALUE pairs", () => {
    expect(parseSecretOptions(["a=1", "db_connection=two"])).toEqual(new Map([
      ["a", "1"],
      ["db_connection", "two"],
    ]));
  });

  it("keeps everything after the first = as the value", () => {
    expect(parseSecretOptions(["db_connection=postgres://user:pass@host/db?a=b"])).toEqual(new Map([
      ["db_connection", "postgres://user:pass@host/db?a=b"],
    ]));
  });

  it("allows empty values", () => {
    expect(parseSecretOptions(["empty="])).toEqual(new Map([["empty", ""]]));
  });

  it("rejects entries without =", () => {
    expect(() => parseSecretOptions(["novalue"])).toThrow("KEY=VALUE");
  });

  it("rejects entries with an empty key", () => {
    expect(() => parseSecretOptions(["=value"])).toThrow("KEY=VALUE");
  });

  it("rejects invalid keys", () => {
    expect(() => parseSecretOptions(["bad key=x"])).toThrow("Invalid --secret key");
    expect(() => parseSecretOptions(["bad.key=x"])).toThrow("Invalid --secret key");
  });

  it("rejects duplicate keys", () => {
    expect(() => parseSecretOptions(["a=1", "a=2"])).toThrow("Duplicate --secret key");
  });
});

describe("extractServiceDefinition", () => {
  const config = {
    deployments: {
      services: {
        api: {
          type: "vercel",
          framework: "nextjs",
          installCommand: "pnpm install",
          buildCommand: "pnpm build",
          outputDirectory: ".next",
          rootDirectory: "./api",
          env: {
            MY_ENV_VAR: { value: "true" },
            DATABASE_CONNECTION_STRING: { type: "secret", key: "db_connection" },
            NEXT_PUBLIC_HEXCLAVE_PROJECT_ID: { type: "connection", value: "hexclave.projectId" },
          },
        },
        minimal: { type: "vercel" },
      },
    },
  };

  it("extracts a fully specified service", () => {
    expect(extractServiceDefinition(config, "api")).toEqual({
      framework: "nextjs",
      installCommand: "pnpm install",
      buildCommand: "pnpm build",
      outputDirectory: ".next",
      rootDirectory: "./api",
      env: {
        MY_ENV_VAR: { value: "true" },
        DATABASE_CONNECTION_STRING: { type: "secret", key: "db_connection" },
        NEXT_PUBLIC_HEXCLAVE_PROJECT_ID: { type: "connection", value: "hexclave.projectId" },
      },
    });
  });

  it("extracts a minimal service", () => {
    expect(extractServiceDefinition(config, "minimal")).toEqual({
      framework: undefined,
      installCommand: undefined,
      buildCommand: undefined,
      outputDirectory: undefined,
      rootDirectory: undefined,
      env: {},
    });
  });

  it("lists available services when the requested one is missing", () => {
    expect(() => extractServiceDefinition(config, "web")).toThrow("Available services: api, minimal");
  });

  it("rejects configs without a deployments.services section", () => {
    expect(() => extractServiceDefinition({}, "api")).toThrow("deployments.services");
  });

  it("rejects services without a type", () => {
    expect(() => extractServiceDefinition({
      deployments: { services: { api: { framework: "nextjs" } } },
    }, "api")).toThrow('Add `type: "vercel"`');
  });

  it("rejects services with an unknown type", () => {
    expect(() => extractServiceDefinition({
      deployments: { services: { api: { type: "netlify" } } },
    }, "api")).toThrow('must be "vercel"');
  });

  it("rejects non-string build fields", () => {
    expect(() => extractServiceDefinition({
      deployments: { services: { api: { type: "vercel", buildCommand: 42 } } },
    }, "api")).toThrow("must be a string");
  });

  it("rejects invalid env var keys", () => {
    expect(() => extractServiceDefinition({
      deployments: { services: { api: { type: "vercel", env: { "1BAD": { value: "x" } } } } },
    }, "api")).toThrow("invalid key");
  });

  it("rejects secret env vars with an inline value", () => {
    expect(() => extractServiceDefinition({
      deployments: { services: { api: { type: "vercel", env: { A: { type: "secret", key: "a", value: "leaked" } } } } },
    }, "api")).toThrow("must not have a `value`");
  });

  it("rejects secret env vars without a key", () => {
    expect(() => extractServiceDefinition({
      deployments: { services: { api: { type: "vercel", env: { A: { type: "secret" } } } } },
    }, "api")).toThrow("must have a `key`");
  });

  it("rejects plain env vars with a secret key", () => {
    expect(() => extractServiceDefinition({
      deployments: { services: { api: { type: "vercel", env: { A: { value: "x", key: "a" } } } } },
    }, "api")).toThrow("must not have a `key`");
  });

  it("rejects the legacy {service.output} interpolation syntax in connections", () => {
    expect(() => extractServiceDefinition({
      deployments: { services: { api: { type: "vercel", env: { A: { type: "connection", value: "{hexclave.projectId}" } } } } },
    }, "api")).toThrow("service output");
  });

  it("rejects unknown env var types", () => {
    expect(() => extractServiceDefinition({
      deployments: { services: { api: { type: "vercel", env: { A: { type: "literal", value: "x" } } } } },
    }, "api")).toThrow("unknown `type`");
  });
});

describe("assertSecretsMatchEnv", () => {
  const env: Record<string, ServiceEnvVarConfig> = {
    PLAIN: { value: "x" },
    DB: { type: "secret", key: "db_connection" },
    API: { type: "secret", key: "api-key" },
    PROJECT: { type: "connection", value: "hexclave.projectId" },
  };

  it("accepts exactly matching secrets", () => {
    expect(() => assertSecretsMatchEnv(env, new Map([["db_connection", "a"], ["api-key", "b"]]))).not.toThrow();
  });

  it("rejects missing secrets", () => {
    expect(() => assertSecretsMatchEnv(env, new Map([["db_connection", "a"]]))).toThrow("Missing secret values for: api-key");
  });

  it("rejects unknown secrets", () => {
    expect(() => assertSecretsMatchEnv(env, new Map([["db_connection", "a"], ["api-key", "b"], ["typo", "c"]]))).toThrow("Unknown --secret key(s): typo");
  });

  it("accepts no secrets when none are referenced", () => {
    expect(() => assertSecretsMatchEnv({ PLAIN: { value: "x" } }, new Map())).not.toThrow();
  });
});

describe("resolveDeployConfigPath", () => {
  const tempDirs: string[] = [];
  const makeTempDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hexclave-deploy-test-"));
    tempDirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefers an explicit --config path", () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, "custom.config.ts");
    fs.writeFileSync(configPath, "export const config = {};");
    expect(resolveDeployConfigPath("custom.config.ts", dir)).toBe(configPath);
  });

  it("errors when the explicit path doesn't exist", () => {
    const dir = makeTempDir();
    expect(() => resolveDeployConfigPath("missing.config.ts", dir)).toThrow("Config file not found");
  });

  it("auto-discovers hexclave.config.ts before stack.config.ts", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "stack.config.ts"), "export const config = {};");
    fs.writeFileSync(path.join(dir, "hexclave.config.ts"), "export const config = {};");
    expect(resolveDeployConfigPath(undefined, dir)).toBe(path.join(dir, "hexclave.config.ts"));
  });

  it("falls back to stack.config.ts", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "stack.config.ts"), "export const config = {};");
    expect(resolveDeployConfigPath(undefined, dir)).toBe(path.join(dir, "stack.config.ts"));
  });

  it("returns undefined when nothing is found (dashboard mode)", () => {
    const dir = makeTempDir();
    expect(resolveDeployConfigPath(undefined, dir)).toBeUndefined();
  });
});
