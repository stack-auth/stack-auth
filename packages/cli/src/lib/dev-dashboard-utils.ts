import { urlString } from "@hexclave/shared/dist/utils/urls";
import { CliError } from "./errors.js";

export type ConfigSyncEventBase = {
  config_file_path: string,
  created_at_millis: number,
};

export type ConfigSyncEvent = ConfigSyncEventBase & ({
  status: "syncing",
} | {
  status: "success",
} | {
  status: "error",
  error_message: string,
});

export type HeartbeatResponse = {
  ok: true,
  browser_secret_confirmation_code?: string,
  browser_secret_confirmation_code_expires_at_millis?: number,
  config_sync_events?: ConfigSyncEvent[],
};

export const DEV_DASHBOARD_COMMAND_ENV_VAR = "HEXCLAVE_CLI_DEV_DASHBOARD_COMMAND";
const LOG_PREFIX = "[Hexclave] ";
const DASHBOARD_STOP_TIMEOUT_MS = 10_000;
const DASHBOARD_FORCE_STOP_TIMEOUT_MS = 2_000;
const DASHBOARD_HEALTH_PROBE_TIMEOUT_MS = 2_000;

export function dashboardEnvWithStatePath(env: NodeJS.ProcessEnv, statePath: string): NodeJS.ProcessEnv {
  return {
    ...env,
    STACK_DEV_ENVS_PATH: env.STACK_DEV_ENVS_PATH ?? statePath,
  };
}

export function devDashboardCommandFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const command = env[DEV_DASHBOARD_COMMAND_ENV_VAR]?.trim();
  return command == null || command.length === 0 ? undefined : command;
}

function stderrSupportsAnsiColor(): boolean {
  return process.stderr.isTTY && process.env.NO_COLOR == null && process.env.TERM !== "dumb";
}

export function configErrorLogPrefix(supportsColor = stderrSupportsAnsiColor()): string {
  const label = supportsColor ? "\x1b[41;37;1m[CONFIG ERROR]\x1b[0m" : "[CONFIG ERROR]";
  return `${LOG_PREFIX}${label} `;
}

type ParsedVersion = {
  core: [number, number, number],
  hasPrerelease: boolean,
};

function parseVersionCore(version: string): ParsedVersion | null {
  const trimmed = version.trim();
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(trimmed);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    hasPrerelease: /^v?\d+\.\d+\.\d+-/.test(trimmed),
  };
}

export function isVersionNewer(candidate: string, current: string): boolean {
  const a = parseVersionCore(candidate);
  const b = parseVersionCore(current);
  if (a == null || b == null) return false;
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i];
  }
  return !a.hasPrerelease && b.hasPrerelease;
}

export function shouldRestartDashboard(latestVersion: string | undefined, runningVersion: string | undefined): boolean {
  return latestVersion != null && runningVersion != null && isVersionNewer(latestVersion, runningVersion);
}

export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrnoException(error) && error.code === "EPERM";
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && typeof error.code === "string";
}

function signalDashboardProcess(pid: number, signal: NodeJS.Signals): void {
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return;
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "ESRCH") throw error;
    }
  }
  process.kill(pid, signal);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConfigSyncEvent(value: unknown): value is ConfigSyncEvent {
  if (
    !isRecord(value) ||
    !("config_file_path" in value) ||
    typeof value.config_file_path !== "string" ||
    !("status" in value) ||
    !("created_at_millis" in value) ||
    typeof value.created_at_millis !== "number"
  ) return false;
  if (value.status === "syncing" || value.status === "success") return true;
  return value.status === "error" && "error_message" in value && typeof value.error_message === "string";
}

export function isHeartbeatResponse(value: unknown): value is HeartbeatResponse {
  return (
    isRecord(value) &&
    "ok" in value &&
    value.ok === true &&
    (!("browser_secret_confirmation_code" in value) || typeof value.browser_secret_confirmation_code === "string") &&
    (!("browser_secret_confirmation_code_expires_at_millis" in value) || typeof value.browser_secret_confirmation_code_expires_at_millis === "number") &&
    (!("config_sync_events" in value) || (Array.isArray(value.config_sync_events) && value.config_sync_events.every(isConfigSyncEvent)))
  );
}

export function logConfigSyncEvents(response: HeartbeatResponse): void {
  for (const event of response.config_sync_events ?? []) {
    if (event.status === "syncing") {
      console.warn(`${LOG_PREFIX}Detected change to config file at ${event.config_file_path}. Syncing...`);
    } else if (event.status === "success") {
      console.warn(`${LOG_PREFIX}Updated config sync successful!`);
    } else {
      console.warn(`${configErrorLogPrefix()}Config sync failed for ${event.config_file_path}: ${event.error_message}`);
    }
  }
}

async function isDashboardReachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DASHBOARD_HEALTH_PROBE_TIMEOUT_MS);
  try {
    // This probe checks liveness for shutdown, so any HTTP response means the port is still bound.
    await fetch(urlString`${url}/api/development-environment/health`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    return true;
  } catch (error) {
    if (error instanceof Error) return false;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function killLocalDashboard(url: string, port: number): Promise<void> {
  const { readDevEnvState } = await import("./dev-env-state.js");
  const pid = readDevEnvState().localDashboardsByPort?.[String(port)]?.pid;
  if (pid == null || pid <= 0 || !processExists(pid)) return;
  try {
    signalDashboardProcess(pid, "SIGTERM");
  } catch (error) {
    if (isErrnoException(error) && (error.code === "ESRCH" || error.code === "EPERM")) return;
    throw error;
  }
  const startedAt = performance.now();
  while (performance.now() - startedAt < 10_000) {
    if (!(await isDashboardReachable(url))) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  try {
    signalDashboardProcess(pid, "SIGKILL");
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ESRCH") throw error;
  }
  const killDeadline = performance.now() + DASHBOARD_FORCE_STOP_TIMEOUT_MS;
  while (performance.now() < killDeadline) {
    if (!(await isDashboardReachable(url))) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (await isDashboardReachable(url)) {
    throw new CliError(`Failed to stop the existing Hexclave dashboard on ${url} (pid ${pid}).`);
  }
}
