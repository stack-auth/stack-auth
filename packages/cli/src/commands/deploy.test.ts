import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateServicesFunction, type ServicesFunctionContext } from "../lib/services-config.js";
import { collectRequiredSecretKeys, deployService, resolveDeployConfigPath } from "./deploy.js";

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

  it("keeps a ready deployment successful without a follow-up service lookup", async () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "index.html"), "<h1>ready</h1>");
    fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM nginx:alpine\n");
    const service = evaluateServicesFunction({
      configPath: path.join(dir, "hexclave.config.ts"),
      servicesExport: () => ({
        web: { type: "container", port: 3000 },
      }),
      mode: "deploy",
    }).services.get("web");
    if (service == null) throw new Error("Test service was not evaluated");

    const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === "https://api.example.com/api/latest/deployments/uploads" && init?.method === "POST") {
        return jsonResponse({
          id: "00000000-0000-4000-8000-000000000001",
          upload_url: "https://storage.example.com/upload",
          content_type: "application/gzip",
          max_bytes: 1024 * 1024,
        });
      }
      if (url === "https://storage.example.com/upload" && init?.method === "PUT") {
        return new Response(null, { status: 200 });
      }
      if (url === "https://api.example.com/api/latest/deployments/services/web/deploy" && init?.method === "POST") {
        if (typeof init.body !== "string") throw new Error("Deploy request body was not JSON");
        expect(JSON.parse(init.body)).toMatchObject({
          upload_id: "00000000-0000-4000-8000-000000000001",
          definition_sync_id: "00000000-0000-4000-8000-000000000003",
        });
        return jsonResponse({ run_id: "00000000-0000-4000-8000-000000000002" });
      }
      if (url === "https://api.example.com/api/latest/deployments/runs/00000000-0000-4000-8000-000000000002" && init?.method === "GET") {
        return jsonResponse({
          status: "ready",
          url: "https://immutable-deployment.example.com",
          error: null,
        });
      }
      return new Response("Unexpected request", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await deployService({
      auth: {
        apiUrl: "https://api.example.com",
        dashboardUrl: "https://dashboard.example.com",
        publishableClientKey: "pck_test",
        projectId: "project-test",
        secretServerKey: "ssk_test",
      },
      authHeaders: () => Promise.resolve({ authorization: "test" }),
      service,
      definitionSyncId: "00000000-0000-4000-8000-000000000003",
      ignoreRootDirectory: dir,
    });

    expect(result).toEqual({
      serviceId: "web",
      status: "ready",
      runId: "00000000-0000-4000-8000-000000000002",
      url: "https://immutable-deployment.example.com",
      error: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
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
        type: "container", port: 3000,
        env: {
          A: secret("zebra"),
          B: secret("alpha"),
          C: secret("zebra"),
          D: secret("with-default", "fallback"),
          E: "plain",
        },
      },
      api: {
        type: "container", port: 3000,
        env: { F: secret("alpha") },
      },
    }));
    expect(collectRequiredSecretKeys(services)).toEqual(["alpha", "zebra"]);
  });

  it("returns an empty list when every secret has a default", () => {
    const services = servicesOf(({ secret }) => ({
      web: { type: "container", port: 3000, env: { A: secret("k", "v") } },
    }));
    expect(collectRequiredSecretKeys(services)).toEqual([]);
  });
});
