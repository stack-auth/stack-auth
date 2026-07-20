import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

let tempDir: string | undefined;
const remoteDevelopmentEnvironmentEnabledEnv = "NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT";
const knownProjectId = "known-project-id";
const knownConfigPath = "/home/dev/app/hexclave.config.ts";

function useTempStateFile() {
  tempDir = mkdtempSync(join(tmpdir(), "stack-rde-availability-"));
  process.env[remoteDevelopmentEnvironmentEnabledEnv] = "true";
  process.env.STACK_DEV_ENVS_PATH = join(tempDir, "dev-envs.json");
  writeFileSync(process.env.STACK_DEV_ENVS_PATH, JSON.stringify({
    version: 1,
    localDashboardsByPort: {
      "26700": {
        port: 26700,
        secret: "secret",
        pid: 123,
        startedAtMillis: Date.now(),
      },
    },
    projectsByConfigPath: {
      [knownConfigPath]: {
        projectId: knownProjectId,
        teamId: "team-id",
        publishableClientKey: "pck",
        secretServerKey: "ssk",
        apiBaseUrl: "http://localhost:8102",
        updatedAtMillis: Date.now(),
      },
    },
  }));
  chmodSync(process.env.STACK_DEV_ENVS_PATH, 0o600);
}

function request(url: string, headers: Record<string, string>) {
  return new NextRequest(url, { headers });
}

async function getResponse(req: NextRequest) {
  const { GET } = await import("./route");
  return await GET(req);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  delete process.env[remoteDevelopmentEnvironmentEnabledEnv];
  delete process.env.STACK_DEV_ENVS_PATH;
  if (tempDir != null) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("development environment project-availability route", () => {
  it("returns 404 when the development environment is disabled", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "stack-rde-availability-"));
    process.env.STACK_DEV_ENVS_PATH = join(tempDir, "dev-envs.json");
    const response = await getResponse(request(
      `http://127.0.0.1:26700/api/development-environment/project-availability?project_id=${knownProjectId}`,
      { host: "127.0.0.1:26700" },
    ));
    expect(response.status).toBe(404);
  });

  it("returns 403 for non-loopback hosts", async () => {
    useTempStateFile();
    const response = await getResponse(request(
      `http://preview.example.test/api/development-environment/project-availability?project_id=${knownProjectId}`,
      { host: "preview.example.test" },
    ));
    expect(response.status).toBe(403);
  });

  it("returns 403 for non-localhost origins", async () => {
    useTempStateFile();
    const response = await getResponse(request(
      `http://127.0.0.1:26700/api/development-environment/project-availability?project_id=${knownProjectId}`,
      { host: "127.0.0.1:26700", origin: "https://evil.example.com" },
    ));
    expect(response.status).toBe(403);
  });

  it("allows requests from a localhost origin (the customer's dev tool)", async () => {
    useTempStateFile();
    const response = await getResponse(request(
      `http://127.0.0.1:26700/api/development-environment/project-availability?project_id=${knownProjectId}`,
      { host: "127.0.0.1:26700", origin: "http://localhost:3000" },
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ running: true, project_available: true });
  });

  it("returns 400 when project_id is missing", async () => {
    useTempStateFile();
    const response = await getResponse(request(
      "http://127.0.0.1:26700/api/development-environment/project-availability",
      { host: "127.0.0.1:26700" },
    ));
    expect(response.status).toBe(400);
  });

  it("reports project_available: true for a project the development environment owns", async () => {
    useTempStateFile();
    const response = await getResponse(request(
      `http://127.0.0.1:26700/api/development-environment/project-availability?project_id=${knownProjectId}`,
      { host: "127.0.0.1:26700" },
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ running: true, project_available: true });
  });

  it("reports project_available: false for an unknown project", async () => {
    useTempStateFile();
    const response = await getResponse(request(
      "http://127.0.0.1:26700/api/development-environment/project-availability?project_id=some-other-project",
      { host: "127.0.0.1:26700" },
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ running: true, project_available: false });
  });
});
