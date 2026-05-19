import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let tempDir: string | undefined;
const remoteDevelopmentEnvironmentEnabledEnv = "NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT";

function useTempStateFile(secret = "secret") {
  tempDir = mkdtempSync(join(tmpdir(), "stack-rde-security-"));
  process.env[remoteDevelopmentEnvironmentEnabledEnv] = "true";
  process.env.STACK_DEV_ENVS_PATH = join(tempDir, "dev-envs.json");
  writeFileSync(process.env.STACK_DEV_ENVS_PATH, JSON.stringify({
    version: 1,
    localDashboard: {
      port: 26700,
      secret,
      pid: 123,
      startedAtMillis: Date.now(),
    },
    projectsByConfigPath: {},
  }));
  chmodSync(process.env.STACK_DEV_ENVS_PATH, 0o600);
}

function request(headers: Record<string, string>) {
  return new Request("http://127.0.0.1:26700/api/remote-development-environment/sessions", { headers }) as any;
}

afterEach(() => {
  delete process.env[remoteDevelopmentEnvironmentEnabledEnv];
  delete process.env.STACK_DEV_ENVS_PATH;
  if (tempDir != null) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("remote development environment security", () => {
  it("is inactive unless explicitly enabled", async () => {
    useTempStateFile();
    delete process.env[remoteDevelopmentEnvironmentEnabledEnv];
    const { assertRemoteDevelopmentEnvironmentRequest } = await import("./security");
    const response = assertRemoteDevelopmentEnvironmentRequest(request({
      host: "127.0.0.1:26700",
      authorization: "Bearer secret",
    }));
    expect(response?.status).toBe(404);
  });

  it("rejects missing or wrong bearer token", async () => {
    useTempStateFile();
    const { assertRemoteDevelopmentEnvironmentRequest } = await import("./security");
    const response = assertRemoteDevelopmentEnvironmentRequest(request({
      host: "127.0.0.1:26700",
      authorization: "Bearer wrong",
    }));
    expect(response?.status).toBe(401);
  });

  it("rejects non-loopback hosts for bearer requests", async () => {
    useTempStateFile();
    const { assertRemoteDevelopmentEnvironmentRequest } = await import("./security");
    const badHost = assertRemoteDevelopmentEnvironmentRequest(request({
      host: "example.com",
      authorization: "Bearer secret",
    }));
    expect(badHost?.status).toBe(403);
  });

  it("allows same-origin browser auth without exposing the CLI bearer token", async () => {
    useTempStateFile();
    const { assertRemoteDevelopmentEnvironmentBrowserRequest } = await import("./security");
    const response = assertRemoteDevelopmentEnvironmentBrowserRequest(request({
      host: "127.0.0.1:26700",
      origin: "http://127.0.0.1:26700",
      "sec-fetch-site": "same-origin",
    }));
    expect(response).toBeNull();
  });

  it("rejects browser auth without an active local dashboard", async () => {
    useTempStateFile("");
    const { assertRemoteDevelopmentEnvironmentBrowserRequest } = await import("./security");
    const response = assertRemoteDevelopmentEnvironmentBrowserRequest(request({
      host: "127.0.0.1:26700",
      origin: "http://127.0.0.1:26700",
      "sec-fetch-site": "same-origin",
    }));
    expect(response?.status).toBe(404);
  });

  it("rejects browser auth from arbitrary localhost origins", async () => {
    useTempStateFile();
    const { assertRemoteDevelopmentEnvironmentBrowserRequest } = await import("./security");
    const response = assertRemoteDevelopmentEnvironmentBrowserRequest(request({
      host: "127.0.0.1:26700",
      origin: "http://evil.localhost:26700",
      "sec-fetch-site": "same-origin",
    }));
    expect(response?.status).toBe(403);
  });

  it("rejects cross-site browser auth navigation", async () => {
    useTempStateFile();
    const { assertRemoteDevelopmentEnvironmentBrowserRequest } = await import("./security");
    const response = assertRemoteDevelopmentEnvironmentBrowserRequest(request({
      host: "127.0.0.1:26700",
      "sec-fetch-site": "cross-site",
    }));
    expect(response?.status).toBe(403);
  });

  it("accepts CLI bearer requests from loopback without trusting arbitrary origins", async () => {
    useTempStateFile();
    const { assertRemoteDevelopmentEnvironmentRequest } = await import("./security");
    const response = assertRemoteDevelopmentEnvironmentRequest(request({
      host: "127.0.0.1:26700",
      origin: "http://evil.localhost:26700",
      authorization: "Bearer secret",
    }));
    expect(response).toBeNull();
  });

  it("rejects config writes without an active session", async () => {
    useTempStateFile();
    const { applyRemoteDevelopmentEnvironmentConfigUpdate } = await import("./manager");
    await expect(applyRemoteDevelopmentEnvironmentConfigUpdate({
      sessionId: "missing",
      configUpdate: {},
    })).rejects.toThrow(/session is not active/);
  });

  it("repairs broad state file permissions before checking requests", async () => {
    useTempStateFile();
    const statePath = process.env.STACK_DEV_ENVS_PATH;
    if (statePath == null) {
      throw new Error("STACK_DEV_ENVS_PATH should be set by useTempStateFile().");
    }
    chmodSync(statePath, 0o644);

    const { assertRemoteDevelopmentEnvironmentRequest } = await import("./security");
    const response = assertRemoteDevelopmentEnvironmentRequest(request({
      host: "127.0.0.1:26700",
      authorization: "Bearer secret",
    }));
    expect(response).toBeNull();
    expect(statSync(statePath).mode & 0o777).toBe(0o600);
  });
});
