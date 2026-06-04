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
  // CLI version that started this dashboard, used to decide whether a
  // reachable dashboard is stale and should be restarted.
  version?: string,
};

export type PendingBrowserSecretConfirmationCode = {
  code: string,
  expiresAtMillis: number,
  updatedAtMillis: number,
};

export type DevEnvState = {
  version: 1,
  anonymousRefreshToken?: string,
  localDashboardsByPort?: Partial<Record<string, LocalDashboardState>>,
  pendingBrowserSecretConfirmationCodesByPort?: Partial<Record<string, PendingBrowserSecretConfirmationCode>>,
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

// Validate an on-disk dashboard record: a hand-edited or cross-version state
// file could carry wrong-typed fields. In particular a non-string `version`
// flows into shouldRestartDashboard ->
// isVersionNewer -> parseVersionCore (version.trim()) inside
// startDashboardIfNeeded, which is not behind the auto-update fail-open guard,
// so it would throw and crash `hexclave dev`. Malformed entries are dropped on
// read (a fresh dashboard is then started for that port).
function isLocalDashboardState(value: unknown): value is LocalDashboardState {
  if (value == null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.port === "number" &&
    Number.isFinite(candidate.port) &&
    typeof candidate.secret === "string" &&
    typeof candidate.pid === "number" &&
    Number.isFinite(candidate.pid) &&
    typeof candidate.startedAtMillis === "number" &&
    Number.isFinite(candidate.startedAtMillis) &&
    (candidate.logPath === undefined || typeof candidate.logPath === "string") &&
    (candidate.version === undefined || typeof candidate.version === "string")
  );
}

// Keep only well-formed per-port dashboard records; drop the rest so a corrupt
// or cross-version entry never reaches the restart/version-parsing path.
function sanitizeLocalDashboardsByPort(value: unknown): Partial<Record<string, LocalDashboardState>> | undefined {
  if (value == null || typeof value !== "object") return undefined;
  const sanitized: Record<string, LocalDashboardState> = {};
  for (const [port, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isLocalDashboardState(entry)) {
      sanitized[port] = entry;
    }
  }
  return sanitized;
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
    localDashboardsByPort: sanitizeLocalDashboardsByPort(parsed.localDashboardsByPort),
    pendingBrowserSecretConfirmationCodesByPort: parsed.pendingBrowserSecretConfirmationCodesByPort,
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
  const secret = existingDashboard?.secret ?? randomBytes(32).toString("hex");
  const dashboardState: LocalDashboardState = {
    port,
    secret,
    pid: existingDashboard?.pid ?? 0,
    startedAtMillis: existingDashboard?.startedAtMillis ?? Date.now(),
    logPath: existingDashboard?.logPath,
    version: existingDashboard?.version,
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

export function recordLocalDashboardProcess(port: number, secret: string, pid: number, logPath: string, version?: string): void {
  const state = readDevEnvState();
  const dashboardState: LocalDashboardState = {
    port,
    secret,
    pid,
    startedAtMillis: Date.now(),
    logPath,
    version,
  };
  writeDevEnvState({
    ...state,
    localDashboardsByPort: {
      ...state.localDashboardsByPort,
      [String(port)]: dashboardState,
    },
  });
}
