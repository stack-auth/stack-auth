import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractServiceBuildConfig, parseEnvOptions, resolveDeployConfigPath } from "./deploy.js";

describe("parseEnvOptions", () => {
  it("parses KEY=VALUE pairs", () => {
    expect(parseEnvOptions(["A=1", "B_2=two"])).toEqual([
      { key: "A", value: "1" },
      { key: "B_2", value: "two" },
    ]);
  });

  it("keeps everything after the first = as the value", () => {
    expect(parseEnvOptions(["DATABASE_URL=postgres://user:pass@host/db?a=b"])).toEqual([
      { key: "DATABASE_URL", value: "postgres://user:pass@host/db?a=b" },
    ]);
  });

  it("keeps {service.output} references verbatim", () => {
    expect(parseEnvOptions(["HEXCLAVE_PROJECT_ID={hexclave.projectId}"])).toEqual([
      { key: "HEXCLAVE_PROJECT_ID", value: "{hexclave.projectId}" },
    ]);
  });

  it("allows empty values", () => {
    expect(parseEnvOptions(["EMPTY="])).toEqual([{ key: "EMPTY", value: "" }]);
  });

  it("rejects entries without =", () => {
    expect(() => parseEnvOptions(["NOVALUE"])).toThrow("KEY=VALUE");
  });

  it("rejects entries with an empty key", () => {
    expect(() => parseEnvOptions(["=value"])).toThrow("KEY=VALUE");
  });

  it("rejects invalid keys", () => {
    expect(() => parseEnvOptions(["1BAD=x"])).toThrow("Invalid --env key");
    expect(() => parseEnvOptions(["BAD-KEY=x"])).toThrow("Invalid --env key");
  });

  it("rejects duplicate keys", () => {
    expect(() => parseEnvOptions(["A=1", "A=2"])).toThrow("Duplicate --env key");
  });
});

describe("extractServiceBuildConfig", () => {
  const config = {
    deployments: {
      services: {
        api: {
          framework: "nextjs",
          installCommand: "pnpm install",
          buildCommand: "pnpm build",
          outputDirectory: ".next",
          rootDirectory: "./api",
          domains: {
            "example-com": { hostname: "example.com" },
            "www-example-com": { hostname: "www.example.com", isPrimary: true },
          },
        },
        minimal: {},
      },
    },
  };

  it("extracts a fully specified service", () => {
    expect(extractServiceBuildConfig(config, "api")).toEqual({
      framework: "nextjs",
      installCommand: "pnpm install",
      buildCommand: "pnpm build",
      outputDirectory: ".next",
      rootDirectory: "./api",
      domains: ["example.com", "www.example.com"],
    });
  });

  it("extracts a minimal service", () => {
    expect(extractServiceBuildConfig(config, "minimal")).toEqual({
      framework: undefined,
      installCommand: undefined,
      buildCommand: undefined,
      outputDirectory: undefined,
      rootDirectory: undefined,
      domains: [],
    });
  });

  it("lists available services when the requested one is missing", () => {
    expect(() => extractServiceBuildConfig(config, "web")).toThrow("Available services: api, minimal");
  });

  it("rejects configs without a deployments.services section", () => {
    expect(() => extractServiceBuildConfig({}, "api")).toThrow("deployments.services");
  });

  it("rejects non-record domains", () => {
    expect(() => extractServiceBuildConfig({
      deployments: { services: { api: { domains: ["example.com"] } } },
    }, "api")).toThrow("must be a record of domain entries");
  });

  it("rejects non-string build fields", () => {
    expect(() => extractServiceBuildConfig({
      deployments: { services: { api: { buildCommand: 42 } } },
    }, "api")).toThrow("must be a string");
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
