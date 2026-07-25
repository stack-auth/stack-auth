import { Command } from "commander";

type DevOptions = { configFile?: string };

export function registerDevCommand(program: Command) {
  program.command("dev").usage("--config-file <path> -- <command> [args...]").description("Run a command with Hexclave development-environment credentials").requiredOption("--config-file <path>", "Path to stack.config.ts").argument("<command...>", "Command and arguments to run after --").action(async (commandArgs: string[], opts: DevOptions) => {
    const { run } = await import("./dev.impl.js");
    await run(commandArgs, opts);
  });
}

type HeartbeatResponse = {
  ok: true,
  browser_secret_confirmation_code?: string,
  browser_secret_confirmation_code_expires_at_millis?: number,
  config_sync_events?: Array<{
      config_file_path: string,
      created_at_millis: number,
      status: "syncing" | "success" | "error",
      error_message?: string,
  }>,
};

const DEV_DASHBOARD_COMMAND_ENV_VAR = "HEXCLAVE_CLI_DEV_DASHBOARD_COMMAND";
export function devDashboardCommandFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const command = env[DEV_DASHBOARD_COMMAND_ENV_VAR]?.trim();
  return command == null || command.length === 0 ? undefined : command;
}
export function configErrorLogPrefix(supportsColor = Boolean(process.stderr.isTTY && process.env.NO_COLOR == null && process.env.TERM !== "dumb")): string {
  const label = supportsColor ? "\x1b[41;37;1m[CONFIG ERROR]\x1b[0m" : "[CONFIG ERROR]";
  return `[Hexclave] ${label} `;
}
type ParsedVersion = { core: [number, number, number], hasPrerelease: boolean };
function parseVersionCore(version: string): ParsedVersion | null {
  const trimmed = version.trim();
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(trimmed);
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], hasPrerelease: /^v?\d+\.\d+\.\d+-/.test(trimmed) };
}
export function isVersionNewer(candidate: string, current: string): boolean {
  const a = parseVersionCore(candidate);
  const b = parseVersionCore(current);
  if (a == null || b == null) return false;
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i];
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
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}
function isConfigSyncEvent(value: unknown): boolean {
  if (value == null || typeof value !== "object" || Array.isArray(value) || !("config_file_path" in value) || typeof value.config_file_path !== "string" || !("status" in value) || !("created_at_millis" in value) || typeof value.created_at_millis !== "number") return false;
  return value.status === "syncing" || value.status === "success" || (value.status === "error" && "error_message" in value && typeof value.error_message === "string");
}
export function isHeartbeatResponse(value: unknown): value is HeartbeatResponse {
  return value != null && typeof value === "object" && !Array.isArray(value) && "ok" in value && value.ok === true && (!("browser_secret_confirmation_code" in value) || typeof value.browser_secret_confirmation_code === "string") && (!("browser_secret_confirmation_code_expires_at_millis" in value) || typeof value.browser_secret_confirmation_code_expires_at_millis === "number") && (!("config_sync_events" in value) || (Array.isArray(value.config_sync_events) && value.config_sync_events.every(isConfigSyncEvent)));
}

export function logConfigSyncEvents(response: HeartbeatResponse): void {
  for (const event of response.config_sync_events ?? []) {
    if (event.status === "syncing") {
      console.warn(`[Hexclave] Detected change to config file at ${event.config_file_path}. Syncing...`);
    } else if (event.status === "success") {
      console.warn("[Hexclave] Updated config sync successful!");
    } else {
      console.warn(`${configErrorLogPrefix()}Config sync failed for ${event.config_file_path}: ${event.error_message}`);
    }
  }
}
export async function killLocalDashboard(url: string, port: number): Promise<void> {
  const { readDevEnvState } = await import("../lib/dev-env-state.js");
  const pid = readDevEnvState().localDashboardsByPort?.[String(port)]?.pid;
  if (pid == null || pid <= 0 || !processExists(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ESRCH" || error.code === "EPERM")) return;
    throw error;
  }
  const startedAt = performance.now();
  while (performance.now() - startedAt < 10_000) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      } else {
        return;
      }
    } catch {
      return;
    }
  }
  process.kill(pid, "SIGKILL");
}
