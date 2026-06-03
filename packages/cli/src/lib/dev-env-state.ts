import { hexclaveDevEnvStatePath } from "@hexclave/shared/dist/utils/dev-env-state-path";
import { randomBytes } from "crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname } from "path";

type LocalDashboardState = {
  port: number,
  secret: string,
  pid: number,
  startedAtMillis: number,
  logPath?: string,
};

export type DevEnvState = {
  version: 1,
  anonymousRefreshToken?: string,
  localDashboardsByPort?: Partial<Record<string, LocalDashboardState>>,
  anonymousApiBaseUrl?: string,
  projectsByConfigPath: Partial<Record<string, {
    projectId: string,
    teamId: string,
    publishableClientKey: string,
    secretServerKey: string,
    apiBaseUrl: string,
    lastSyncedConfigHash?: string,
    updatedAtMillis: number,
  }>>,
};

export function devEnvStatePath(): string {
  return hexclaveDevEnvStatePath();
}

export function readDevEnvState(): DevEnvState {
  const path = devEnvStatePath();
  if (!existsSync(path)) {
    return { version: 1, projectsByConfigPath: {} };
  }
  if (process.platform !== "win32" && (statSync(path).mode & 0o077) !== 0) {
    chmodSync(path, 0o600);
    if ((statSync(path).mode & 0o077) !== 0) {
      throw new Error(`${path} must not be readable or writable by group/others. Run: chmod 600 ${path}`);
    }
  }
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<DevEnvState>;
  return {
    version: 1,
    anonymousRefreshToken: typeof parsed.anonymousRefreshToken === "string" ? parsed.anonymousRefreshToken : undefined,
    anonymousApiBaseUrl: typeof parsed.anonymousApiBaseUrl === "string" ? parsed.anonymousApiBaseUrl : undefined,
    localDashboardsByPort: parsed.localDashboardsByPort,
    projectsByConfigPath: parsed.projectsByConfigPath ?? {},
  };
}

export function writeDevEnvState(state: DevEnvState): void {
  const path = devEnvStatePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function ensureLocalDashboardSecret(port: number): string {
  const state = readDevEnvState();
  const portKey = String(port);
  const existingDashboard = state.localDashboardsByPort?.[portKey];
  const existing =
    existingDashboard?.secret;
  const secret = existing ?? randomBytes(32).toString("hex");
  const dashboardState: LocalDashboardState = {
    port,
    secret,
    pid: existingDashboard?.pid ?? 0,
    startedAtMillis: existingDashboard?.startedAtMillis ?? Date.now(),
    logPath: existingDashboard?.logPath,
  };
  writeDevEnvState({
    ...state,
    localDashboardsByPort: {
      ...state.localDashboardsByPort,
      [portKey]: dashboardState,
    },
  });
  return secret;
}

export function recordLocalDashboardProcess(port: number, secret: string, pid: number, logPath: string): void {
  const state = readDevEnvState();
  const dashboardState: LocalDashboardState = {
    port,
    secret,
    pid,
    startedAtMillis: Date.now(),
    logPath,
  };
  writeDevEnvState({
    ...state,
    localDashboardsByPort: {
      ...state.localDashboardsByPort,
      [String(port)]: dashboardState,
    },
  });
}
