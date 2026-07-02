import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { writeDevEnvState } from "./dev-env-state";
import { resolveLocalDashboardAuthByConfigPath } from "./local-dashboard-client";

let tempDir: string | undefined;

function useTempStateFile(): string {
  tempDir = mkdtempSync(join(tmpdir(), "stack-local-dashboard-client-"));
  process.env.STACK_DEV_ENVS_PATH = join(tempDir, "dev-envs.json");
  return tempDir;
}

afterEach(() => {
  delete process.env.STACK_DEV_ENVS_PATH;
  delete process.env.NEXT_PUBLIC_HEXCLAVE_LOCAL_DASHBOARD_PORT;
  if (tempDir != null) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("resolveLocalDashboardAuthByConfigPath", () => {
  it("resolves project auth from dashboard dev-env state", async () => {
    const dir = useTempStateFile();
    const configPath = join(dir, "hexclave.config.ts");
    writeFileSync(configPath, "");
    writeDevEnvState({
      version: 1,
      anonymousRefreshToken: "rt_dev",
      projectsByConfigPath: {
        [configPath]: {
          projectId: "proj_dev",
          teamId: "team_dev",
          publishableClientKey: "pck_dev",
          secretServerKey: "ssk_dev",
          apiBaseUrl: "http://127.0.0.1:8102",
          updatedAtMillis: 1,
        },
      },
    });

    await expect(resolveLocalDashboardAuthByConfigPath(configPath)).resolves.toMatchObject({
      apiUrl: "http://127.0.0.1:8102",
      dashboardUrl: "http://127.0.0.1:26700",
      refreshToken: "rt_dev",
      projectId: "proj_dev",
    });
  });

  it("uses the configured local dashboard port in returned auth", async () => {
    const dir = useTempStateFile();
    const configPath = join(dir, "hexclave.config.ts");
    process.env.NEXT_PUBLIC_HEXCLAVE_LOCAL_DASHBOARD_PORT = "9101";
    writeFileSync(configPath, "");
    writeDevEnvState({
      version: 1,
      anonymousRefreshToken: "rt_dev",
      projectsByConfigPath: {
        [configPath]: {
          projectId: "proj_dev",
          teamId: "team_dev",
          publishableClientKey: "pck_dev",
          secretServerKey: "ssk_dev",
          apiBaseUrl: "http://127.0.0.1:8102",
          updatedAtMillis: 1,
        },
      },
    });

    await expect(resolveLocalDashboardAuthByConfigPath(configPath)).resolves.toMatchObject({
      dashboardUrl: "http://127.0.0.1:9101",
    });
  });

  it("requires the dashboard anonymous session from state", async () => {
    const dir = useTempStateFile();
    const configPath = join(dir, "hexclave.config.ts");
    writeFileSync(configPath, "");
    writeDevEnvState({
      version: 1,
      projectsByConfigPath: {
        [configPath]: {
          projectId: "proj_dev",
          teamId: "team_dev",
          publishableClientKey: "pck_dev",
          secretServerKey: "ssk_dev",
          apiBaseUrl: "http://127.0.0.1:8102",
          updatedAtMillis: 1,
        },
      },
    });

    await expect(resolveLocalDashboardAuthByConfigPath(configPath)).rejects.toThrow(/no development-environment user session/);
  });
});
