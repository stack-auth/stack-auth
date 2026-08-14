import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateDeploymentConfig, importConfigModule, importDeployModule, resolveDeployFilePath, type ServicesFunctionContext } from "../lib/deployment-config.js";
import { collectPublicUrls, collectRequiredSecretKeys, packageAndUploadSource, resolveConfigPushPath } from "./deploy.js";

const TEST_AUTH = {
  apiUrl: "https://api.example.com",
  dashboardUrl: "https://dashboard.example.com",
  publishableClientKey: "pck_test",
  projectId: "project-test",
  secretServerKey: "ssk_test",
};

describe("deploy command helpers", () => {
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("prefers an explicit --deploy-file path", () => {
    const dir = makeTempDir();
    const deployFilePath = path.join(dir, "custom.deploy.ts");
    fs.writeFileSync(deployFilePath, "export const deploy = { services: {} };");
    expect(resolveDeployFilePath("custom.deploy.ts", dir)).toBe(deployFilePath);
  });

  it("errors when the explicit deploy file doesn't exist", () => {
    const dir = makeTempDir();
    expect(() => resolveDeployFilePath("missing.deploy.ts", dir)).toThrow("Deploy file not found");
  });

  it("auto-discovers hexclave.deploy.ts", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "hexclave.deploy.ts"), "export const deploy = { services: {} };");
    expect(resolveDeployFilePath(undefined, dir)).toBe(path.join(dir, "hexclave.deploy.ts"));
  });

  it("loads the author-facing deploy export from deploy and config files", async () => {
    const dir = makeTempDir();
    const deployFilePath = path.join(dir, "hexclave.deploy.ts");
    const configFilePath = path.join(dir, "hexclave.config.ts");
    fs.writeFileSync(deployFilePath, 'export const id = "source"; export const deploy = () => ({ services: {} });');
    fs.writeFileSync(configFilePath, "export const config = {}; export const deploy = () => ({ services: {} });");

    const deployModule = await importDeployModule(deployFilePath);
    const configModule = await importConfigModule(configFilePath);
    expect(deployModule.id).toBe("source");
    expect(deployModule.deploy).toBeTypeOf("function");
    expect(configModule.deploy).toBeTypeOf("function");
  });

  // The deploy file is a different document from hexclave.config.ts, so a
  // project that has only the latter has nothing to deploy.
  it("errors when no deploy file is found", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "hexclave.config.ts"), "export const config = {};");
    expect(() => resolveDeployFilePath(undefined, dir)).toThrow("No deploy file found");
  });

  it("resolves the config file for --config-push, and returns null when there is none", () => {
    const dir = makeTempDir();
    expect(resolveConfigPushPath(undefined, dir)).toBe(null);
    fs.writeFileSync(path.join(dir, "stack.config.ts"), "export const config = {};");
    expect(resolveConfigPushPath(undefined, dir)).toBe(path.join(dir, "stack.config.ts"));
    fs.writeFileSync(path.join(dir, "hexclave.config.ts"), "export const config = {};");
    expect(resolveConfigPushPath(undefined, dir)).toBe(path.join(dir, "hexclave.config.ts"));
    expect(() => resolveConfigPushPath("missing.config.ts", dir)).toThrow("Config file not found");
  });

  it("returns one final URL for each successfully deployed public service", () => {
    const services = evaluateDeploymentConfig({
      deployFilePath: path.join(os.tmpdir(), "hexclave.deploy.ts"),
      idExport: "test-source",
      deployExport: () => ({ services: {
        web: { type: "serverless", public: true, ports: { 3000: { protocol: "http" } } },
        worker: { type: "serverless", ports: { 3001: { protocol: "http" } } },
        failed: { type: "serverless", public: true, ports: { 3002: { protocol: "http" } } },
      } }),
      mode: "deploy",
    }).services;
    expect(collectPublicUrls(["web", "worker", "failed"], services, new Map([
      ["web", { serviceId: "web", status: "deployed", url: "https://web.fly.dev", error: null }],
      ["worker", { serviceId: "worker", status: "deployed", url: null, error: null }],
      ["failed", { serviceId: "failed", status: "failed", url: null, error: "failed" }],
    ]))).toEqual([{ serviceId: "web", url: "https://web.fly.dev" }]);
  });

  it("reports every public port of a multi-port service", () => {
    // The runtime returns ONE url for the service — the standard-ports holder's,
    // which is why it carries no port. Every other public port hangs off it by
    // number, and would otherwise appear nowhere the author looks.
    const services = evaluateDeploymentConfig({
      deployFilePath: path.join(os.tmpdir(), "hexclave.deploy.ts"),
      idExport: "test-source",
      deployExport: () => ({ services: {
        // Declared high-first on purpose: the holder is the lowest port NUMBER,
        // not whichever key was written first.
        web: { type: "serverless", public: true, ports: { 8443: { protocol: "http" }, 3000: { protocol: "http" } } },
      } }),
      mode: "deploy",
    }).services;
    expect(collectPublicUrls(["web"], services, new Map([
      ["web", { serviceId: "web", status: "deployed", url: "https://web.fly.dev", error: null }],
    ]))).toEqual([
      { serviceId: "web", url: "https://web.fly.dev" },
      { serviceId: "web", url: "https://web.fly.dev:8443" },
    ]);
  });

  it("fails before upload when a declared dockerfilePath is not in the packaged source", async () => {
    // The pre-flight reads the actual TAR contents rather than the filesystem,
    // so a .dockerignore mistake fails here in seconds instead of minutes later
    // in a remote builder.
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "index.html"), "<h1>no dockerfile</h1>");
    const services = evaluateDeploymentConfig({
      deployFilePath: path.join(dir, "hexclave.deploy.ts"),
      idExport: "test-source",
      deployExport: () => ({ services: {
        web: { type: "serverless", ports: { 3000: { protocol: "http" } }, dockerfilePath: "Dockerfile" },
      } }),
      mode: "deploy",
    }).services;
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(packageAndUploadSource({
      auth: TEST_AUTH,
      authHeaders: () => Promise.resolve({ authorization: "test" }),
      sourceRoot: dir,
      services,
    })).rejects.toThrow("there is no such file");
  });

  it("notes an ignored Dockerfile when no dockerfilePath is set", async () => {
    // A Dockerfile in the source is deliberately NOT picked up implicitly — but silently
    // ignoring it would be a trap, so the deploy must say what it is doing instead.
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM nginx:alpine\n");
    const services = evaluateDeploymentConfig({
      deployFilePath: path.join(dir, "hexclave.deploy.ts"),
      idExport: "test-source",
      deployExport: () => ({ services: {
        web: { type: "serverless", ports: { 3000: { protocol: "http" } } },
      } }),
      mode: "deploy",
    }).services;
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line) => logged.push(String(line)));
    // Fail at the first network call — the note is logged during packaging, before it.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));

    await expect(packageAndUploadSource({
      auth: TEST_AUTH,
      authHeaders: () => Promise.resolve({ authorization: "test" }),
      sourceRoot: dir,
      services,
    })).rejects.toThrow();
    expect(logged.some((line) => line.includes("Railpack auto-detection") && line.includes('dockerfilePath: "Dockerfile"'))).toBe(true);
  });
});

describe("collectRequiredSecretKeys", () => {
  const servicesOf = (definition: (ctx: ServicesFunctionContext) => unknown) => [...evaluateDeploymentConfig({
    deployFilePath: path.join(os.tmpdir(), "hexclave.deploy.ts"),
    idExport: "test-source",
    deployExport: (ctx: ServicesFunctionContext) => ({ services: definition(ctx) }),
    mode: "deploy",
  }).services.values()];

  it("collects only secrets without defaults, deduplicated and sorted", () => {
    const services = servicesOf(({ secret }) => ({
      web: {
        type: "serverless", ports: { 3000: { protocol: "http" } },
        env: {
          A: secret("zebra"),
          B: secret("alpha"),
          C: secret("zebra"),
          D: secret("with-default", "fallback"),
          E: "plain",
        },
      },
      api: {
        type: "serverless", ports: { 3000: { protocol: "http" } },
        env: { F: secret("alpha") },
      },
    }));
    expect(collectRequiredSecretKeys(services)).toEqual(["alpha", "zebra"]);
  });

  it("returns an empty list when every secret has a default", () => {
    const services = servicesOf(({ secret }) => ({
      web: { type: "serverless", ports: { 3000: { protocol: "http" } }, env: { A: secret("k", "v") } },
    }));
    expect(collectRequiredSecretKeys(services)).toEqual([]);
  });
});
