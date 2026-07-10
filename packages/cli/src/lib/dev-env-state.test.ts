import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { devEnvStatePath, ensureLocalDashboardSecret, readDevEnvState, recordLocalDashboardProcess, writeDevEnvState } from "./dev-env-state";

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
    expect(readDevEnvState().localDashboardsByPort).toMatchObject({
      "9101": { port: 9101, secret: first },
    });
  });

  it("keeps dashboard secrets separate per port", () => {
    useTempStateFile();
    const first = ensureLocalDashboardSecret(9101);
    const second = ensureLocalDashboardSecret(9102);

    expect(second).not.toBe(first);
    expect(ensureLocalDashboardSecret(9101)).toBe(first);
    expect(readDevEnvState().localDashboardsByPort).toMatchObject({
      "9101": { port: 9101, secret: first },
      "9102": { port: 9102, secret: second },
    });
  });

  it("records the dashboard process without rotating the secret", () => {
    useTempStateFile();
    const secret = ensureLocalDashboardSecret(26700);
    recordLocalDashboardProcess(26700, secret, 12345, "/tmp/stack-rde-dashboard.log");

    expect(readDevEnvState().localDashboardsByPort).toMatchObject({
      "26700": {
        port: 26700,
        secret,
        pid: 12345,
        logPath: "/tmp/stack-rde-dashboard.log",
      },
    });
  });

  it("records the CLI version that started the dashboard", () => {
    useTempStateFile();
    const secret = ensureLocalDashboardSecret(26700);
    recordLocalDashboardProcess(26700, secret, 12345, "/tmp/stack-rde-dashboard.log", "2.8.110");
    expect(readDevEnvState().localDashboardsByPort?.["26700"]?.version).toBe("2.8.110");
  });

  it("preserves a previously recorded dashboard version when ensuring the secret", () => {
    useTempStateFile();
    const secret = ensureLocalDashboardSecret(26700);
    recordLocalDashboardProcess(26700, secret, 12345, "/tmp/stack-rde-dashboard.log", "2.8.110");
    ensureLocalDashboardSecret(26700);
    expect(readDevEnvState().localDashboardsByPort?.["26700"]?.version).toBe("2.8.110");
  });

  it("does not clobber projectsByConfigPath or anonymousRefreshToken across writes", () => {
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
    ensureLocalDashboardSecret(26700);
    const state = readDevEnvState();
    expect(state.anonymousRefreshToken).toBe("rt-123");
    expect(state.projectsByConfigPath["/a/stack.config.ts"]?.projectId).toBe("p");
  });

  it("reads a recorded dashboard without a version field as version undefined", () => {
    useTempStateFile();
    const statePath = process.env.STACK_DEV_ENVS_PATH;
    if (statePath == null) {
      throw new Error("STACK_DEV_ENVS_PATH should be set by useTempStateFile().");
    }
    writeFileSync(statePath, JSON.stringify({
      version: 1,
      localDashboardsByPort: { "26700": { port: 26700, secret: "s", pid: 999, startedAtMillis: 1 } },
      projectsByConfigPath: {},
    }), { mode: 0o600 });
    const state = readDevEnvState();
    expect(state.localDashboardsByPort?.["26700"]?.pid).toBe(999);
    expect(state.localDashboardsByPort?.["26700"]?.version).toBeUndefined();
  });

  it("drops a per-port dashboard whose version is a non-string", () => {
    useTempStateFile();
    const statePath = process.env.STACK_DEV_ENVS_PATH;
    if (statePath == null) {
      throw new Error("STACK_DEV_ENVS_PATH should be set by useTempStateFile().");
    }
    // A hand-edited / cross-version file with a non-string version would
    // otherwise reach parseVersionCore (version.trim()) and throw, crashing
    // `hexclave dev` outside the auto-update fail-open guard. Drop the entry.
    writeFileSync(statePath, JSON.stringify({
      version: 1,
      localDashboardsByPort: { "26700": { port: 26700, secret: "s", pid: 999, startedAtMillis: 1, version: 2 } },
      projectsByConfigPath: {},
    }), { mode: 0o600 });
    expect(readDevEnvState().localDashboardsByPort?.["26700"]).toBeUndefined();
  });

  it("drops a structurally malformed per-port dashboard on read", () => {
    useTempStateFile();
    const statePath = process.env.STACK_DEV_ENVS_PATH;
    if (statePath == null) {
      throw new Error("STACK_DEV_ENVS_PATH should be set by useTempStateFile().");
    }
    // Missing secret + non-numeric pid: not a usable dashboard record.
    writeFileSync(statePath, JSON.stringify({
      version: 1,
      localDashboardsByPort: { "26700": { port: 26700, pid: "nope", startedAtMillis: 1 } },
      projectsByConfigPath: {},
    }), { mode: 0o600 });
    expect(readDevEnvState().localDashboardsByPort?.["26700"]).toBeUndefined();
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
