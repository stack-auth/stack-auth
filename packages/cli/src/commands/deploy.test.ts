import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateServicesFunction, type ServicesFunctionContext } from "../lib/services-config.js";
import { collectRequiredSecretKeys, resolveDeployConfigPath } from "./deploy.js";

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

  it("prefers an explicit --config-file path", () => {
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

  it("errors when no config file is found (a config file is required now)", () => {
    const dir = makeTempDir();
    expect(() => resolveDeployConfigPath(undefined, dir)).toThrow("No config file found");
  });
});

describe("collectRequiredSecretKeys", () => {
  const servicesOf = (definition: (ctx: ServicesFunctionContext) => unknown) => [...evaluateServicesFunction({
    configPath: path.join(os.tmpdir(), "hexclave.config.ts"),
    servicesExport: definition,
    mode: "deploy",
  }).services.values()];

  it("collects only secrets without defaults, deduplicated and sorted", () => {
    const services = servicesOf(({ secret }) => ({
      web: {
        type: "vercel",
        env: {
          A: secret("zebra"),
          B: secret("alpha"),
          C: secret("zebra"),
          D: secret("with-default", "fallback"),
          E: "plain",
        },
      },
      api: {
        type: "vercel",
        env: { F: secret("alpha") },
      },
    }));
    expect(collectRequiredSecretKeys(services)).toEqual(["alpha", "zebra"]);
  });

  it("returns an empty list when every secret has a default", () => {
    const services = servicesOf(({ secret }) => ({
      web: { type: "vercel", env: { A: secret("k", "v") } },
    }));
    expect(collectRequiredSecretKeys(services)).toEqual([]);
  });
});
