import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

let tempDir: string | undefined;
const remoteDevelopmentEnvironmentEnabledEnv = "NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT";

function useTempStateFile(secret = "secret") {
  tempDir = mkdtempSync(join(tmpdir(), "stack-rde-health-"));
  process.env[remoteDevelopmentEnvironmentEnabledEnv] = "true";
  process.env.STACK_DEV_ENVS_PATH = join(tempDir, "dev-envs.json");
  writeFileSync(process.env.STACK_DEV_ENVS_PATH, JSON.stringify({
    version: 1,
    localDashboardsByPort: {
      "26700": {
        port: 26700,
        secret,
        pid: 123,
        startedAtMillis: Date.now(),
      },
    },
    projectsByConfigPath: {},
  }));
  chmodSync(process.env.STACK_DEV_ENVS_PATH, 0o600);
}

function request(headers: Record<string, string>) {
  return new NextRequest("http://127.0.0.1:26700/api/development-environment/health", { headers });
}

async function getHealthResponse(req: Request) {
  const { GET } = await import("./route");
  return await GET(req as any);
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

describe("development environment health route", () => {
  it("rejects browser health checks without a browser secret", async () => {
    useTempStateFile();
    const response = await getHealthResponse(request({
      host: "127.0.0.1:26700",
      origin: "http://127.0.0.1:26700",
      "sec-fetch-site": "same-origin",
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("x-hexclave-development-environment-browser-secret-error")).toBe("invalid_browser_secret");
  });

  it("allows CLI bearer health checks from loopback", async () => {
    useTempStateFile();
    const response = await getHealthResponse(request({
      host: "127.0.0.1:26700",
      authorization: "Bearer secret",
    }));

    expect(response.status).toBe(503);
  });

  it("rejects CLI bearer health checks from non-loopback hosts", async () => {
    useTempStateFile();
    const response = await getHealthResponse(new NextRequest("http://preview.example.test/api/development-environment/health", {
      headers: {
        host: "preview.example.test",
        authorization: "Bearer secret",
      },
    }));

    expect(response.status).toBe(403);
  });
});
