import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { devEnvStatePath, ensureLocalDashboardSecret, readCliUpdateCheckCache, readDevEnvState, recordLocalDashboardProcess, writeCliUpdateCheckCache, writeDevEnvState } from "./dev-env-state";

let tempDir: string | undefined;

function useTempStateFile() {
  tempDir = mkdtempSync(join(tmpdir(), "stack-dev-env-state-"));
  process.env.STACK_DEV_ENVS_PATH = join(tempDir, "dev-envs.json");
}

afterEach(() => {
  delete process.env.STACK_DEV_ENVS_PATH;
  delete process.env.LOCALAPPDATA;
  vi.restoreAllMocks();
  if (tempDir != null) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("dev env state", () => {
  it("uses the Windows local app data directory by default on Windows", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    process.env.LOCALAPPDATA = "C:\\Users\\Test\\AppData\\Local";
    expect(devEnvStatePath()).toBe(join("C:\\Users\\Test\\AppData\\Local", "Hexclave", "dev-envs.json"));
  });

  it("returns an empty v1 state when no file exists", () => {
    useTempStateFile();
    expect(readDevEnvState()).toEqual({
      version: 1,
      projectsByConfigPath: {},
    });
  });

  it("persists the dashboard secret without replacing it", () => {
    useTempStateFile();
    const first = ensureLocalDashboardSecret(9101);
    const second = ensureLocalDashboardSecret(9101);
    expect(second).toBe(first);
    expect(readDevEnvState().localDashboard).toMatchObject({
      port: 9101,
      secret: first,
    });
  });

  it("records the dashboard process without rotating the secret", () => {
    useTempStateFile();
    const secret = ensureLocalDashboardSecret(26700);
    recordLocalDashboardProcess(26700, secret, 12345, "/tmp/stack-rde-dashboard.log");

    expect(readDevEnvState().localDashboard).toMatchObject({
      port: 26700,
      secret,
      pid: 12345,
      logPath: "/tmp/stack-rde-dashboard.log",
    });
  });

  it("records the CLI version that started the dashboard", () => {
    useTempStateFile();
    const secret = ensureLocalDashboardSecret(26700);
    recordLocalDashboardProcess(26700, secret, 12345, "/tmp/stack-rde-dashboard.log", "2.8.110");
    expect(readDevEnvState().localDashboard?.version).toBe("2.8.110");
  });

  it("preserves a previously recorded dashboard version when ensuring the secret", () => {
    useTempStateFile();
    const secret = ensureLocalDashboardSecret(26700);
    recordLocalDashboardProcess(26700, secret, 12345, "/tmp/stack-rde-dashboard.log", "2.8.110");
    ensureLocalDashboardSecret(26700);
    expect(readDevEnvState().localDashboard?.version).toBe("2.8.110");
  });

  it("round-trips the latest-version update-check cache", () => {
    useTempStateFile();
    expect(readCliUpdateCheckCache()).toBeUndefined();
    writeCliUpdateCheckCache({ packageName: "@hexclave/cli", latestVersion: "2.0.0", checkedAtMillis: 123 });
    expect(readCliUpdateCheckCache()).toEqual({ packageName: "@hexclave/cli", latestVersion: "2.0.0", checkedAtMillis: 123 });
  });

  it("drops a malformed cliUpdateCheck entry on read", () => {
    useTempStateFile();
    const statePath = process.env.STACK_DEV_ENVS_PATH;
    if (statePath == null) {
      throw new Error("STACK_DEV_ENVS_PATH should be set by useTempStateFile().");
    }
    // Wrong-typed fields (e.g. hand-edited or cross-version): latestVersion is a
    // number and checkedAtMillis is a string — must be treated as "no cache" so
    // version parsing never sees a non-string.
    writeFileSync(statePath, JSON.stringify({
      version: 1,
      cliUpdateCheck: { packageName: "@hexclave/cli", latestVersion: 2, checkedAtMillis: "soon" },
      projectsByConfigPath: {},
    }), { mode: 0o600 });
    expect(readCliUpdateCheckCache()).toBeUndefined();
  });

  it("keeps a well-formed cliUpdateCheck entry on read", () => {
    useTempStateFile();
    const statePath = process.env.STACK_DEV_ENVS_PATH;
    if (statePath == null) {
      throw new Error("STACK_DEV_ENVS_PATH should be set by useTempStateFile().");
    }
    writeFileSync(statePath, JSON.stringify({
      version: 1,
      cliUpdateCheck: { packageName: "@hexclave/cli", latestVersion: "2.0.0", checkedAtMillis: 123 },
      projectsByConfigPath: {},
    }), { mode: 0o600 });
    expect(readCliUpdateCheckCache()).toEqual({ packageName: "@hexclave/cli", latestVersion: "2.0.0", checkedAtMillis: 123 });
  });

  it("does not clobber the dashboard record when writing the update-check cache", () => {
    useTempStateFile();
    const secret = ensureLocalDashboardSecret(26700);
    recordLocalDashboardProcess(26700, secret, 12345, "/tmp/stack-rde-dashboard.log", "2.8.110");
    writeCliUpdateCheckCache({ packageName: "@hexclave/cli", latestVersion: "2.0.0", checkedAtMillis: 123 });
    const state = readDevEnvState();
    expect(state.localDashboard?.pid).toBe(12345);
    expect(state.cliUpdateCheck?.latestVersion).toBe("2.0.0");
  });

  it("does not clobber projectsByConfigPath or anonymousRefreshToken when writing the update-check cache", () => {
    useTempStateFile();
    writeDevEnvState({
      version: 1,
      anonymousRefreshToken: "rt-123",
      projectsByConfigPath: {
        "/a/stack.config.ts": {
          projectId: "p", teamId: "t", publishableClientKey: "pk",
          secretServerKey: "sk", apiBaseUrl: "http://x", updatedAtMillis: 1,
        },
      },
    });
    writeCliUpdateCheckCache({ packageName: "@hexclave/cli", latestVersion: "2.0.0", checkedAtMillis: 1 });
    const state = readDevEnvState();
    expect(state.anonymousRefreshToken).toBe("rt-123");
    expect(state.projectsByConfigPath["/a/stack.config.ts"]?.projectId).toBe("p");
    expect(state.cliUpdateCheck?.latestVersion).toBe("2.0.0");
  });

  it("reads localDashboard.version as undefined from a legacy file without that field", () => {
    useTempStateFile();
    const statePath = process.env.STACK_DEV_ENVS_PATH;
    if (statePath == null) {
      throw new Error("STACK_DEV_ENVS_PATH should be set by useTempStateFile().");
    }
    writeFileSync(statePath, JSON.stringify({
      version: 1,
      localDashboard: { port: 26700, secret: "s", pid: 999, startedAtMillis: 1 },
      projectsByConfigPath: {},
    }), { mode: 0o600 });
    const state = readDevEnvState();
    expect(state.localDashboard?.pid).toBe(999);
    expect(state.localDashboard?.version).toBeUndefined();
  });

  it("writes state as owner-readable JSON", () => {
    useTempStateFile();
    writeDevEnvState({
      version: 1,
      anonymousRefreshToken: "rt",
      projectsByConfigPath: {},
    });
    const statePath = process.env.STACK_DEV_ENVS_PATH;
    if (statePath == null) {
      throw new Error("STACK_DEV_ENVS_PATH should be set by useTempStateFile().");
    }
    const content = readFileSync(statePath, "utf-8");
    if (process.platform !== "win32") {
      expect(statSync(statePath).mode & 0o777).toBe(0o600);
    }
    expect(JSON.parse(content)).toMatchObject({
      version: 1,
      anonymousRefreshToken: "rt",
    });
  });

  it("repairs state file permissions before reading", () => {
    if (process.platform === "win32") {
      return;
    }
    useTempStateFile();
    const statePath = process.env.STACK_DEV_ENVS_PATH;
    if (statePath == null) {
      throw new Error("STACK_DEV_ENVS_PATH should be set by useTempStateFile().");
    }
    writeFileSync(statePath, JSON.stringify({ version: 1, projectsByConfigPath: {} }));
    chmodSync(statePath, 0o644);

    expect(readDevEnvState()).toEqual({
      version: 1,
      projectsByConfigPath: {},
    });
    expect(statSync(statePath).mode & 0o777).toBe(0o600);
  });

  it("does not enforce POSIX state file permissions on Windows", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    useTempStateFile();
    const statePath = process.env.STACK_DEV_ENVS_PATH;
    if (statePath == null) {
      throw new Error("STACK_DEV_ENVS_PATH should be set by useTempStateFile().");
    }
    writeFileSync(statePath, JSON.stringify({ version: 1, projectsByConfigPath: {} }));
    chmodSync(statePath, 0o644);

    expect(readDevEnvState()).toEqual({
      version: 1,
      projectsByConfigPath: {},
    });
  });
});
