import "server-only";

import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname } from "path";
import { stackDevEnvStatePath } from "@stackframe/stack-shared/dist/utils/dev-env-state-path";
import { assertRemoteDevelopmentEnvironmentEnabled } from "./env";

export type RemoteDevelopmentEnvironmentProject = {
  projectId: string,
  teamId: string,
  publishableClientKey: string,
  secretServerKey: string,
  apiBaseUrl: string,
  lastSyncedConfigHash?: string,
  updatedAtMillis: number,
};

export type RemoteDevelopmentEnvironmentState = {
  version: 1,
  anonymousRefreshToken?: string,
  localDashboard?: {
    port: number,
    secret: string,
    pid: number,
    startedAtMillis: number,
    logPath?: string,
  },
  anonymousApiBaseUrl?: string,
  projectsByConfigPath: Partial<Record<string, RemoteDevelopmentEnvironmentProject>>,
};

export function devEnvsStatePath(): string {
  return stackDevEnvStatePath();
}

export function emptyRemoteDevelopmentEnvironmentState(): RemoteDevelopmentEnvironmentState {
  return {
    version: 1,
    projectsByConfigPath: {},
  };
}

export function readRemoteDevelopmentEnvironmentState(): RemoteDevelopmentEnvironmentState {
  assertRemoteDevelopmentEnvironmentEnabled();
  const path = devEnvsStatePath();
  if (!existsSync(path)) {
    return emptyRemoteDevelopmentEnvironmentState();
  }
  if ((statSync(path).mode & 0o077) !== 0) {
    chmodSync(path, 0o600);
    if ((statSync(path).mode & 0o077) !== 0) {
      throw new Error(`${path} must not be readable or writable by group/others. Run: chmod 600 ${path}`);
    }
  }
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<RemoteDevelopmentEnvironmentState>;
  return {
    version: 1,
    anonymousRefreshToken: typeof parsed.anonymousRefreshToken === "string" ? parsed.anonymousRefreshToken : undefined,
    anonymousApiBaseUrl: typeof parsed.anonymousApiBaseUrl === "string" ? parsed.anonymousApiBaseUrl : undefined,
    localDashboard: parsed.localDashboard,
    projectsByConfigPath: parsed.projectsByConfigPath ?? {},
  };
}

export function writeRemoteDevelopmentEnvironmentState(state: RemoteDevelopmentEnvironmentState): void {
  assertRemoteDevelopmentEnvironmentEnabled();
  const path = devEnvsStatePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function updateRemoteDevelopmentEnvironmentState(
  updater: (state: RemoteDevelopmentEnvironmentState) => RemoteDevelopmentEnvironmentState,
): RemoteDevelopmentEnvironmentState {
  const next = updater(readRemoteDevelopmentEnvironmentState());
  writeRemoteDevelopmentEnvironmentState(next);
  return next;
}
