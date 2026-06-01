import { randomBytes } from "crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname } from "path";
import { stackDevEnvStatePath } from "@hexclave/shared/dist/utils/dev-env-state-path";

export type CliUpdateCheckCache = {
  packageName: string,
  latestVersion: string,
  checkedAtMillis: number,
};

export type DevEnvState = {
  version: 1,
  anonymousRefreshToken?: string,
  localDashboard?: {
    port: number,
    secret: string,
    pid: number,
    startedAtMillis: number,
    logPath?: string,
    // CLI version that started this dashboard, used to decide whether a
    // reachable dashboard is stale and should be restarted.
    version?: string,
  },
  anonymousApiBaseUrl?: string,
  // Memoized result of the latest-version registry lookup (see self-update.ts).
  cliUpdateCheck?: CliUpdateCheckCache,
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
  return stackDevEnvStatePath();
}

// Validate the on-disk cache shape: a hand-edited or cross-version state file
// could carry a wrong-typed entry, and a non-string latestVersion would later
// throw in version parsing. Treat anything malformed as "no cache".
function isCliUpdateCheckCache(value: unknown): value is CliUpdateCheckCache {
  if (value == null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.packageName === "string" &&
    typeof candidate.latestVersion === "string" &&
    typeof candidate.checkedAtMillis === "number" &&
    Number.isFinite(candidate.checkedAtMillis)
  );
}

type LocalDashboardState = NonNullable<DevEnvState["localDashboard"]>;

// Validate the on-disk dashboard record, mirroring isCliUpdateCheckCache: a
// hand-edited or cross-version state file could carry wrong-typed fields. In
// particular a non-string `version` flows into shouldRestartDashboard ->
// isVersionNewer -> parseVersionCore (version.trim()) inside
// startDashboardIfNeeded, which is not behind the auto-update fail-open guard,
// so it would throw and crash `stack dev`. Treat anything malformed as "no
// dashboard recorded" (a fresh one is then started).
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
    localDashboard: isLocalDashboardState(parsed.localDashboard) ? parsed.localDashboard : undefined,
    cliUpdateCheck: isCliUpdateCheckCache(parsed.cliUpdateCheck) ? parsed.cliUpdateCheck : undefined,
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
  const existing = state.localDashboard?.secret;
  const secret = existing ?? randomBytes(32).toString("hex");
  writeDevEnvState({
    ...state,
    localDashboard: {
      port,
      secret,
      pid: state.localDashboard?.pid ?? 0,
      startedAtMillis: state.localDashboard?.startedAtMillis ?? Date.now(),
      logPath: state.localDashboard?.logPath,
      version: state.localDashboard?.version,
    },
  });
  return secret;
}

export function recordLocalDashboardProcess(port: number, secret: string, pid: number, logPath: string, version?: string): void {
  writeDevEnvState({
    ...readDevEnvState(),
    localDashboard: {
      port,
      secret,
      pid,
      startedAtMillis: Date.now(),
      logPath,
      version,
    },
  });
}

export function readCliUpdateCheckCache(): CliUpdateCheckCache | undefined {
  return readDevEnvState().cliUpdateCheck;
}

export function writeCliUpdateCheckCache(cache: CliUpdateCheckCache): void {
  writeDevEnvState({
    ...readDevEnvState(),
    cliUpdateCheck: cache,
  });
}
