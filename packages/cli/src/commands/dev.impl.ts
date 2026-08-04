import { execFileSync, spawn, type ChildProcess } from "child_process";
import { Command } from "commander";
import crossSpawn from "cross-spawn";
import { chmodSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from "fs";
import { dirname, join, resolve } from "path";
import { DEFAULT_API_URL, DEFAULT_PUBLISHABLE_CLIENT_KEY, resolveLoginConfig } from "../lib/auth.js";
import { forwardSignals } from "../lib/child-process.js";
import { resolveConfigFilePathOption } from "../lib/config-file-path.js";
import { DASHBOARD_SERVER_RELATIVE_PATH, dashboardDirOverride, fetchDashboardManifestCached, resolveDashboardRuntime, type DashboardManifest } from "../lib/dashboard-release.js";
import { devEnvStatePath, ensureLocalDashboardSecret, readDevEnvState, recordLocalDashboardProcess } from "../lib/dev-env-state.js";
import { dashboardEnvWithStatePath, devDashboardCommandFromEnv, isHeartbeatResponse, killLocalDashboard, logConfigSyncEvents, shouldRestartDashboard, DEV_DASHBOARD_COMMAND_ENV_VAR, type HeartbeatResponse } from "../lib/dev-dashboard-utils.js";
import { CliError, errorMessage } from "../lib/errors.js";
import { DASHBOARD_PORT_ENV_VAR, dashboardPort, dashboardRequest, dashboardUrl, createRemoteDevelopmentEnvironmentSession, type DashboardSessionResponse } from "../lib/local-dashboard.js";
import { startProgress } from "../lib/progress.js";

type ChildCommand = {
  command: string,
  args: string[],
};

type DevOptions = {
  configFile?: string,
};

const HEARTBEAT_INTERVAL_MS = 1_000;
const HEARTBEAT_STOP_POLL_MS = 100;
const DASHBOARD_RESTART_MIN_UPTIME_MS = 5_000;
const DASHBOARD_START_TIMEOUT_MS = 60_000;
const DASHBOARD_HEALTH_PATH = "/api/development-environment/health";
const DEV_DASHBOARD_DIST_DIR_ENV_VAR = "HEXCLAVE_DASHBOARD_NEXT_DIST_DIR";
const RDE_DASHBOARD_LOG_PATH_ENV_VAR = "HEXCLAVE_RDE_DASHBOARD_LOG_PATH";
const DASHBOARD_RUNTIME_DIR_NAME = "rde-dashboard-runtime";
const SENTINEL_PREFIX = "STACK_ENV_VAR_SENTINEL_";
const USE_INLINE_ENV_VARS_SENTINEL = "STACK_ENV_VAR_SENTINEL_USE_INLINE_ENV_VARS";
const SENTINEL_REGEX = /STACK_ENV_VAR_SENTINEL(?:_[A-Z0-9_]+)?/g;
const LOG_PREFIX = "[Hexclave] ";
const REQUIRED_DASHBOARD_RUNTIME_ENV_VARS = new Set([
  "NEXT_PUBLIC_STACK_API_URL",
  "NEXT_PUBLIC_BROWSER_STACK_API_URL",
  "NEXT_PUBLIC_SERVER_STACK_API_URL",
  "NEXT_PUBLIC_STACK_DASHBOARD_URL",
  "NEXT_PUBLIC_BROWSER_STACK_DASHBOARD_URL",
  "NEXT_PUBLIC_SERVER_STACK_DASHBOARD_URL",
  "NEXT_PUBLIC_STACK_PROJECT_ID",
  "NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY",
  "NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT",
  "NEXT_PUBLIC_STACK_IS_PREVIEW",
  DASHBOARD_PORT_ENV_VAR,
]);

type DashboardSessionState = {
  session: DashboardSessionResponse,
  dashboardReachableSinceMs: number,
};

function wait(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function splitDevCommandArgs(commandArgs: string[]): ChildCommand {
  if (commandArgs.length === 0) {
    throw new CliError("Missing command. Usage: hexclave dev --config-file <path> -- <command> [args...]");
  }
  const command = commandArgs[0];
  return { command, args: commandArgs.slice(1) };
}

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  if (url.hostname === "localhost") {
    url.hostname = "127.0.0.1";
  }
  return url.toString().replace(/\/$/, "");
}

function logDev(message: string): void {
  console.warn(`${LOG_PREFIX}${message}`);
}

// Opt-in per-phase startup timing for `hexclave dev`, enabled with
// HEXCLAVE_DEV_TIMING=1 (or true/yes). It attributes boot latency to concrete
// phases — dashboard reuse/startup vs. remote-session creation vs. handing off
// to the user's own command — so a slow `hexclave dev` can be diagnosed instead
// of guessed at. Disabled runs pay nothing and print nothing.
type DevTimer = {
  mark: (label: string) => void,
};

const NOOP_DEV_TIMER: DevTimer = { mark: () => {} };

function devTimingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.HEXCLAVE_DEV_TIMING?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function createDevTimer(): DevTimer {
  if (!devTimingEnabled()) return NOOP_DEV_TIMER;
  const startedAt = performance.now();
  let lastAt = startedAt;
  return {
    mark: (label: string) => {
      const now = performance.now();
      logDev(`timing: ${label} +${(now - lastAt).toFixed(0)}ms (total ${(now - startedAt).toFixed(0)}ms)`);
      lastAt = now;
    },
  };
}

function openUrlInBrowser(url: string): boolean {
  try {
    if (process.platform === "darwin") {
      execFileSync("open", [url], { stdio: "ignore" });
      return true;
    }
    if (process.platform === "win32") {
      execFileSync("cmd", ["/c", "start", "", url], { stdio: "ignore" });
      return true;
    }
    execFileSync("xdg-open", [url], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function maybeOpenOnboardingPage(session: DashboardSessionResponse, port: number): void {
  if (!session.onboarding_outstanding) {
    return;
  }
  const url = `${dashboardUrl(port)}/new-project?project_id=${encodeURIComponent(session.project_id)}`;
  const opened = openUrlInBrowser(url);
  if (opened) {
    logDev(`Onboarding is still pending for project ${session.project_id}. Opened: ${url}`);
  } else {
    logDev(`Onboarding is still pending for project ${session.project_id}. Open this URL manually: ${url}`);
  }
}

function dashboardRuntimeRoot(port: number): string {
  return join(dirname(devEnvStatePath()), `${DASHBOARD_RUNTIME_DIR_NAME}-${port}`);
}

function dashboardLogPath(port: number): string {
  return join(dirname(devEnvStatePath()), `rde-dashboard-${port}.log`);
}

function replaceSentinels(content: string, env: NodeJS.ProcessEnv): string {
  return content.replace(SENTINEL_REGEX, (sentinel) => {
    if (sentinel === USE_INLINE_ENV_VARS_SENTINEL) {
      return "true";
    }
    if (!sentinel.startsWith(SENTINEL_PREFIX)) {
      return sentinel;
    }
    const envVarName = sentinel.slice(SENTINEL_PREFIX.length);
    const value = env[envVarName];
    if (value == null) {
      if (REQUIRED_DASHBOARD_RUNTIME_ENV_VARS.has(envVarName)) {
        throw new CliError(`Missing environment variable ${envVarName} while preparing the bundled dashboard runtime.`);
      }
      return sentinel;
    }
    return value;
  });
}

function replaceDashboardRuntimeSentinels(root: string, env: NodeJS.ProcessEnv): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      replaceDashboardRuntimeSentinels(path, env);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const buffer = readFileSync(path);
    if (!buffer.includes("STACK_ENV_VAR_SENTINEL")) {
      continue;
    }
    writeFileSync(path, replaceSentinels(buffer.toString("utf-8"), env));
  }
}

function dashboardRuntimeLockPath(port: number): string {
  return `${dashboardRuntimeRoot(port)}.lock`;
}

function prepareDashboardRuntime(env: NodeJS.ProcessEnv, port: number, dashboardRoot: string): string {
  if (!existsSync(join(dashboardRoot, DASHBOARD_SERVER_RELATIVE_PATH))) {
    throw new CliError("The Hexclave development-environment dashboard is missing its server entrypoint.");
  }
  const runtimeRoot = dashboardRuntimeRoot(port);
  mkdirSync(dirname(runtimeRoot), { recursive: true });
  rmSync(runtimeRoot, { recursive: true, force: true });
  cpSync(dashboardRoot, runtimeRoot, { recursive: true });
  replaceDashboardRuntimeSentinels(runtimeRoot, env);

  const runtimeServerPath = join(runtimeRoot, DASHBOARD_SERVER_RELATIVE_PATH);
  if (!existsSync(runtimeServerPath)) {
    throw new CliError("The Hexclave development-environment dashboard is missing its server entrypoint.");
  }
  return runtimeServerPath;
}

async function isDashboardReachable(url: string, secret?: string): Promise<boolean> {
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (secret) {
      headers.Authorization = `Bearer ${secret}`;
    }
    const response = await fetch(`${url}${DASHBOARD_HEALTH_PATH}`, { headers });
    if (!secret) {
      // Without a secret we only care whether the port is still bound (used by
      // killLocalDashboard to detect process shutdown), so any HTTP response suffices.
      return true;
    }
    const body: unknown = await response.json();
    return (
      typeof body === "object"
      && body !== null
      && "ok" in body
      && typeof body.ok === "boolean"
      && "restart_command" in body
      && typeof body.restart_command === "string"
    );
  } catch {
    return false;
  }
}

function signalDashboardProcess(pid: number, signal: NodeJS.Signals): void {
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        throw error;
      }
    }
  }

  process.kill(pid, signal);
}

function startDashboardProcess(options: {
  dashboardEnv: NodeJS.ProcessEnv,
  logFd: number,
  port: number,
  dashboardRoot?: string,
}): ChildProcess {
  const devDashboardCommand = devDashboardCommandFromEnv(process.env);
  if (devDashboardCommand != null) {
    writeSync(options.logFd, `Using ${DEV_DASHBOARD_COMMAND_ENV_VAR}: ${devDashboardCommand}\n`);
    return spawn(devDashboardCommand, {
      cwd: process.cwd(),
      detached: true,
      env: options.dashboardEnv,
      shell: true,
      stdio: ["ignore", options.logFd, options.logFd],
    });
  }

  if (options.dashboardRoot == null) {
    throw new CliError("Internal error: the Hexclave dashboard build was not resolved before starting.");
  }
  const dashboardServerPath = prepareDashboardRuntime(options.dashboardEnv, options.port, options.dashboardRoot);
  return spawn(process.execPath, [dashboardServerPath], {
    cwd: resolve(dirname(dashboardServerPath), "../.."),
    detached: true,
    stdio: ["ignore", options.logFd, options.logFd],
    env: options.dashboardEnv,
  });
}

async function startDashboardIfNeeded(options: { apiBaseUrl: string, secret: string, port: number, timer?: DevTimer }): Promise<void> {
  const timer = options.timer ?? NOOP_DEV_TIMER;
  const url = dashboardUrl(options.port);
  const devDashboardCommand = devDashboardCommandFromEnv(process.env);

  // Look up the newest published release to decide whether to restart a running
  // dashboard and which build to launch. Skipped for a custom dev command or a
  // local-build override; a null manifest (offline) reuses the running dashboard
  // or falls back to cache.
  const dashboardOverride = dashboardDirOverride();
  const skipReleaseLookup = devDashboardCommand != null || dashboardOverride != null;
  if (!skipReleaseLookup) {
    logDev("Checking for Hexclave dashboard updates...");
  }
  const [manifest, dashboardReachable] = await Promise.all([
    skipReleaseLookup ? null : fetchDashboardManifestCached(),
    isDashboardReachable(url, options.secret),
  ]);
  timer.mark("manifest + reachability probe");
  const latestVersion = manifest?.version;

  if (dashboardReachable) {
    const runningDashboard = readDevEnvState().localDashboardsByPort?.[String(options.port)];
    const runningVersion = runningDashboard?.version;
    if (devDashboardCommand != null && runningVersion != null) {
      // A custom dev command should take over a release/override dashboard left
      // running from a prior run. A custom-command dashboard records no version,
      // so `runningVersion != null` avoids needlessly restarting that one.
      logDev("A custom Hexclave dashboard command is configured; restarting the running dashboard...");
      await killLocalDashboard(url, options.port);
    } else if (dashboardOverride != null && runningVersion !== "local") {
      // A local-build override should win over a release dashboard left running
      // from a prior run; the override always resolves to version "local".
      logDev("A local Hexclave dashboard override is configured; restarting the running dashboard...");
      await killLocalDashboard(url, options.port);
    } else if (shouldRestartDashboard(latestVersion, runningVersion)) {
      logDev(`A newer Hexclave dashboard (${latestVersion}) is available; restarting from ${runningVersion}...`);
      await killLocalDashboard(url, options.port);
    } else {
      logDev(`Using existing Hexclave dashboard on ${url}.`);
      if (runningDashboard?.logPath != null) {
        logDev(`Dashboard logs: ${runningDashboard.logPath}`);
      }
      timer.mark("reused existing dashboard");
      return;
    }
  }

  // Download (or reuse a cached copy of) the dashboard build to launch. Not
  // needed when a custom dev dashboard command runs the dashboard itself.
  const release = devDashboardCommand == null ? await resolveDashboardRuntime({ manifest, onProgress: (message) => logDev(`${message}...`) }) : null;
  timer.mark("dashboard runtime resolved");

  const progress = startProgress(`Hexclave dashboard not found on port ${options.port}. Starting now`, { prefix: LOG_PREFIX });
  const dashboardEnv = {
    ...dashboardEnvWithStatePath(process.env, devEnvStatePath()),
    NODE_ENV: devDashboardCommand == null ? "production" : "development",
    PORT: String(options.port),
    HOSTNAME: "0.0.0.0",
    [DEV_DASHBOARD_DIST_DIR_ENV_VAR]: process.env[DEV_DASHBOARD_DIST_DIR_ENV_VAR] ?? ".next-development-environment",
    STACK_API_URL: options.apiBaseUrl,
    NEXT_PUBLIC_STACK_API_URL: options.apiBaseUrl,
    NEXT_PUBLIC_BROWSER_STACK_API_URL: options.apiBaseUrl,
    NEXT_PUBLIC_SERVER_STACK_API_URL: options.apiBaseUrl,
    NEXT_PUBLIC_STACK_DASHBOARD_URL: url,
    NEXT_PUBLIC_BROWSER_STACK_DASHBOARD_URL: url,
    NEXT_PUBLIC_SERVER_STACK_DASHBOARD_URL: url,
    NEXT_PUBLIC_STACK_PROJECT_ID: "internal",
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: DEFAULT_PUBLISHABLE_CLIENT_KEY,
    NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT: "true",
    NEXT_PUBLIC_STACK_IS_PREVIEW: "false",
    [DASHBOARD_PORT_ENV_VAR]: String(options.port),
    [RDE_DASHBOARD_LOG_PATH_ENV_VAR]: dashboardLogPath(options.port),
  };
  try {
    const logPath = dashboardLogPath(options.port);
    mkdirSync(dirname(logPath), { recursive: true });
    const logFd = openSync(logPath, "a", 0o600);
    chmodSync(logPath, 0o600);
    writeSync(logFd, `\n[${new Date().toISOString()}] Starting Hexclave development-environment dashboard on ${url}\n`);
    // Acquire a filesystem lock so parallel `hexclave dev` invocations don't
    // race on the runtime directory. openSync with 'wx' is an atomic
    // exclusive-create; EEXIST means another process holds the lock.
    let lockAcquired = false;
    const lockPath = dashboardRuntimeLockPath(options.port);
    // Remove stale lock left behind if a previous process was killed mid-prepare
    // (normal hold time is <1 s, so 5 s is certainly stale).
    try {
      const lockStat = statSync(lockPath);
      if (Date.now() - lockStat.mtimeMs > 5000) {
        unlinkSync(lockPath);
      }
    } catch {
      // lock doesn't exist or was already removed — fine
    }
    try {
      closeSync(openSync(lockPath, "wx"));
      lockAcquired = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    if (!lockAcquired) {
      closeSync(logFd);
      logDev("Another process is starting the dashboard; waiting for it...");
    } else {
      try {
        const child = (() => {
          try {
            return startDashboardProcess({ dashboardEnv, logFd, port: options.port, dashboardRoot: release?.root });
          } finally {
            closeSync(logFd);
          }
        })();
        if (child.pid == null) {
          throw new CliError(`Failed to start the development environment dashboard process. Dashboard logs: ${logPath}`);
        }
        recordLocalDashboardProcess(options.port, options.secret, child.pid, logPath, release?.version);
        logDev(`Dashboard logs: ${logPath}`);
        child.unref();
        timer.mark("dashboard process spawned");
      } finally {
        try {
          unlinkSync(lockPath);
        } catch {
          // best-effort cleanup
        }
      }
    }

    const startedAt = performance.now();
    while (performance.now() - startedAt < DASHBOARD_START_TIMEOUT_MS) {
      if (await isDashboardReachable(url, options.secret)) {
        timer.mark("dashboard reachable");
        progress.stop(`Started Hexclave dashboard`);
        return;
      }
      await wait(500);
    }

    throw new CliError(`Timed out waiting for the development environment dashboard to start at ${url}. Dashboard logs: ${logPath}`);
  } catch (error) {
    progress.stop();
    throw error;
  }
}

function logBrowserSecretConfirmationCode(response: HeartbeatResponse): void {
  if (response.browser_secret_confirmation_code == null) return;
  const expiresAtMillis = response.browser_secret_confirmation_code_expires_at_millis;
  const expiresInSeconds = expiresAtMillis == null
    ? undefined
    : Math.max(0, Math.ceil((expiresAtMillis - Date.now()) / 1000));
  logDev(expiresInSeconds == null
    ? `Dashboard browser confirmation code: ${response.browser_secret_confirmation_code}`
    : `Dashboard browser confirmation code: ${response.browser_secret_confirmation_code} (expires in ${expiresInSeconds}s)`);
}

function pendingBrowserSecretConfirmationCodeFromState(port: number): HeartbeatResponse | null {
  const pending = readDevEnvState().pendingBrowserSecretConfirmationCodesByPort?.[String(port)];
  if (pending == null || pending.expiresAtMillis <= Date.now()) {
    return null;
  }
  return {
    ok: true,
    browser_secret_confirmation_code: pending.code,
    browser_secret_confirmation_code_expires_at_millis: pending.expiresAtMillis,
  };
}

function maybeLogPendingBrowserSecretConfirmationCodeFromState(port: number, lastLoggedConfirmationCode: string | null): string | null {
  const pending = pendingBrowserSecretConfirmationCodeFromState(port);
  const code = pending?.browser_secret_confirmation_code;
  if (code == null || code === lastLoggedConfirmationCode) {
    return lastLoggedConfirmationCode;
  }
  if (pending == null) {
    return lastLoggedConfirmationCode;
  }
  logBrowserSecretConfirmationCode(pending);
  return code;
}

async function logPendingBrowserSecretConfirmationCodesUntilStopped(options: {
  port: number,
  shouldStop: () => boolean,
}): Promise<void> {
  let lastLoggedConfirmationCode: string | null = null;
  while (!options.shouldStop()) {
    lastLoggedConfirmationCode = maybeLogPendingBrowserSecretConfirmationCodeFromState(options.port, lastLoggedConfirmationCode);
    await wait(1_000);
  }
}

const APP_COMMAND_WRAPPER_PARENT_PID_ENV_VAR = "HEXCLAVE_DEV_APP_COMMAND_PARENT_PID";
const APP_COMMAND_WRAPPER_COMMAND_ENV_VAR = "HEXCLAVE_DEV_APP_COMMAND";
const APP_COMMAND_WRAPPER_ARGS_ENV_VAR = "HEXCLAVE_DEV_APP_COMMAND_ARGS_JSON";

const APP_COMMAND_WRAPPER_SCRIPT = String.raw`
const { spawn } = require("node:child_process");

const parentPid = Number(process.env.HEXCLAVE_DEV_APP_COMMAND_PARENT_PID);
const command = process.env.HEXCLAVE_DEV_APP_COMMAND;
const rawArgs = process.env.HEXCLAVE_DEV_APP_COMMAND_ARGS_JSON ?? "[]";
if (!Number.isSafeInteger(parentPid) || parentPid <= 0 || !command) {
  console.error("[Hexclave] Invalid app-command wrapper configuration.");
  process.exit(1);
}

let args;
try {
  args = JSON.parse(rawArgs);
} catch (error) {
  console.error("[Hexclave] Invalid app-command argument payload.", error);
  process.exit(1);
}
if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
  console.error("[Hexclave] Invalid app-command arguments.");
  process.exit(1);
}

const childEnv = { ...process.env };
delete childEnv.HEXCLAVE_DEV_APP_COMMAND_PARENT_PID;
delete childEnv.HEXCLAVE_DEV_APP_COMMAND;
delete childEnv.HEXCLAVE_DEV_APP_COMMAND_ARGS_JSON;

const child = spawn(command, args, {
  env: childEnv,
  stdio: "inherit",
});

let stopping = false;
let forceKillTimer;

function signalOwnProcessGroup(signal) {
  try {
    process.kill(-process.pid, signal);
  } catch {
    // best-effort
  }
}

function stopProcessGroup(signal) {
  if (stopping) return;
  stopping = true;
  signalOwnProcessGroup(signal);
  forceKillTimer = setTimeout(() => signalOwnProcessGroup("SIGKILL"), 5000);
  forceKillTimer.unref();
}

process.on("SIGINT", () => stopProcessGroup("SIGINT"));
process.on("SIGTERM", () => stopProcessGroup("SIGTERM"));

const parentWatch = setInterval(() => {
  try {
    process.kill(parentPid, 0);
  } catch {
    stopProcessGroup("SIGTERM");
  }
}, 1000);
parentWatch.unref();

child.on("close", (code, signal) => {
  clearInterval(parentWatch);
  if (forceKillTimer != null) clearTimeout(forceKillTimer);
  if (code != null) {
    process.exit(code);
  }
  if (signal === "SIGINT") process.exit(130);
  if (signal === "SIGTERM") process.exit(143);
  if (signal === "SIGKILL") process.exit(137);
  process.exit(1);
});

child.on("error", (error) => {
  console.error("[Hexclave] Failed to run app command:", error);
  process.exit(1);
});
`;

export function runChildProcess(command: ChildCommand, env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = process.platform === "win32"
      // cross-spawn handles Windows command shims that Node cannot spawn directly.
      ? crossSpawn(command.command, command.args, { stdio: "inherit", env })
      : spawn(process.execPath, ["-e", APP_COMMAND_WRAPPER_SCRIPT], {
        detached: true,
        stdio: "inherit",
        env: {
          ...env,
          [APP_COMMAND_WRAPPER_PARENT_PID_ENV_VAR]: String(process.pid),
          [APP_COMMAND_WRAPPER_COMMAND_ENV_VAR]: command.command,
          [APP_COMMAND_WRAPPER_ARGS_ENV_VAR]: JSON.stringify(command.args),
        },
      });
    const cleanup = forwardSignals(child, {
      forceKillAfterMs: 5_000,
      processGroup: process.platform !== "win32",
    });
    child.on("close", (code) => {
      cleanup();
      resolvePromise(code ?? 1);
    });
    child.on("error", (err) => {
      cleanup();
      reject(new CliError(`Failed to run ${command.command}: ${err.message}`));
    });
  });
}

async function restartDashboardForHeartbeat(options: {
  apiBaseUrl: string,
  configFilePath: string,
  dashboardReachableSinceMs: number,
  port: number,
  secret: string,
}): Promise<DashboardSessionResponse> {
  const dashboardUptimeMs = performance.now() - options.dashboardReachableSinceMs;
  if (dashboardUptimeMs < DASHBOARD_RESTART_MIN_UPTIME_MS) {
    throw new CliError(`Local Hexclave dashboard stopped before it had been running for ${DASHBOARD_RESTART_MIN_UPTIME_MS / 1000} seconds. Not restarting to avoid a restart loop.`);
  }

  logDev("Local Hexclave dashboard stopped. Restarting...");
  await startDashboardIfNeeded({ apiBaseUrl: options.apiBaseUrl, secret: options.secret, port: options.port });
  return await createRemoteDevelopmentEnvironmentSession({
    apiBaseUrl: options.apiBaseUrl,
    configFilePath: options.configFilePath,
    port: options.port,
    secret: options.secret,
  });
}

async function waitForHeartbeatIntervalOrStop(shouldStop: () => boolean): Promise<boolean> {
  const startedAtMs = performance.now();
  while (!shouldStop()) {
    const remainingMs = HEARTBEAT_INTERVAL_MS - (performance.now() - startedAtMs);
    if (remainingMs <= 0) return false;
    await wait(Math.min(remainingMs, HEARTBEAT_STOP_POLL_MS));
  }
  return true;
}

async function heartbeatUntilStopped(sessionState: DashboardSessionState, options: {
  apiBaseUrl: string,
  configFilePath: string,
  port: number,
  secret: string,
  shouldStop: () => boolean,
}): Promise<void> {
  let lastLoggedConfirmationCode: string | null = null;
  let heartbeatAttempt = 0;
  while (!options.shouldStop()) {
    if (await waitForHeartbeatIntervalOrStop(options.shouldStop)) {
      return;
    }
    lastLoggedConfirmationCode = maybeLogPendingBrowserSecretConfirmationCodeFromState(options.port, lastLoggedConfirmationCode);
    heartbeatAttempt += 1;

    let response: Response;
    const controller = new AbortController();
    const abortOnStop = setInterval(() => {
      if (options.shouldStop()) {
        controller.abort();
      }
    }, HEARTBEAT_STOP_POLL_MS);
    try {
      response = await dashboardRequest(`/api/remote-development-environment/sessions/${encodeURIComponent(sessionState.session.session_id)}/heartbeat`, {
        method: "POST",
        signal: controller.signal,
      }, options.secret, options.port);
    } catch (error) {
      lastLoggedConfirmationCode = maybeLogPendingBrowserSecretConfirmationCodeFromState(options.port, lastLoggedConfirmationCode);
      if (options.shouldStop()) return;
      logDev(`Development environment heartbeat request failed; restarting dashboard: ${errorMessage(error)}`);
      sessionState.session = await restartDashboardForHeartbeat({
        apiBaseUrl: options.apiBaseUrl,
        configFilePath: options.configFilePath,
        dashboardReachableSinceMs: sessionState.dashboardReachableSinceMs,
        port: options.port,
        secret: options.secret,
      });
      sessionState.dashboardReachableSinceMs = performance.now();
      logDev(`Hexclave dashboard running at ${dashboardUrl(options.port)}`);
      continue;
    } finally {
      clearInterval(abortOnStop);
    }

    if (!response.ok) {
      logDev(`Development environment heartbeat failed (${response.status}): ${await response.text()}`);
      sessionState.session = await restartDashboardForHeartbeat({
        apiBaseUrl: options.apiBaseUrl,
        configFilePath: options.configFilePath,
        dashboardReachableSinceMs: sessionState.dashboardReachableSinceMs,
        port: options.port,
        secret: options.secret,
      });
      sessionState.dashboardReachableSinceMs = performance.now();
      logDev(`Hexclave dashboard running at ${dashboardUrl(options.port)}`);
      continue;
    }

    let heartbeatBody: unknown;
    try {
      heartbeatBody = await response.json();
    } catch {
      logDev("Development environment heartbeat returned unparseable JSON.");
      continue;
    }
    if (!isHeartbeatResponse(heartbeatBody)) {
      logDev("Development environment heartbeat returned an invalid response.");
      continue;
    }
    // Deduplicate: only log a confirmation code once per unique code value.
    if (heartbeatBody.browser_secret_confirmation_code != null &&
        heartbeatBody.browser_secret_confirmation_code !== lastLoggedConfirmationCode) {
      logBrowserSecretConfirmationCode(heartbeatBody);
      lastLoggedConfirmationCode = heartbeatBody.browser_secret_confirmation_code;
    }
    logConfigSyncEvents(heartbeatBody);
  }
}

async function closeSession(sessionId: string, secret: string, port: number): Promise<void> {
  let response: Response;
  try {
    response = await dashboardRequest(`/api/remote-development-environment/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    }, secret, port);
  } catch (error) {
    logDev(`Failed to close development environment session: ${errorMessage(error)}`);
    return;
  }
  if (!response.ok) {
    logDev(`Failed to close development environment session (${response.status}): ${await response.text()}`);
  }
}


export async function run(commandArgs: string[], opts: DevOptions) {
  if (opts.configFile == null) {
    throw new CliError("--config-file is required.");
  }

  const timer = createDevTimer();
  const childCommand = splitDevCommandArgs(commandArgs);
  const port = dashboardPort();
  const localDashboardUrl = dashboardUrl(port);
  const secret = ensureLocalDashboardSecret(port);
  const config = resolveLoginConfig();
  const apiBaseUrl = normalizeApiBaseUrl(config.apiUrl || DEFAULT_API_URL);
  const configFilePath = resolveConfigFilePathOption(opts.configFile, { mustExist: false });
  timer.mark("config resolved");
  await startDashboardIfNeeded({ apiBaseUrl, secret, port, timer });
  timer.mark("dashboard ready");
  const session = await createRemoteDevelopmentEnvironmentSession({
    apiBaseUrl,
    configFilePath,
    port,
    secret,
  });
  timer.mark("remote session created");
  const sessionState: DashboardSessionState = {
    session,
    dashboardReachableSinceMs: performance.now(),
  };
  logDev(`Hexclave dashboard running at ${localDashboardUrl}`);
  maybeOpenOnboardingPage(sessionState.session, port);

  let stopped = false;
  const heartbeat = heartbeatUntilStopped(sessionState, {
    apiBaseUrl,
    configFilePath,
    port,
    secret,
    shouldStop: () => stopped,
  });
  const browserSecretCodePolling = logPendingBrowserSecretConfirmationCodesUntilStopped({
    port,
    shouldStop: () => stopped,
  });
  let exitCode = 1;
  try {
    timer.mark("starting app command");
    exitCode = await runChildProcess(childCommand, {
      ...process.env,
      ...sessionState.session.env,
    });
  } finally {
    stopped = true;
    await Promise.all([heartbeat, browserSecretCodePolling]);
    await closeSession(sessionState.session.session_id, secret, port);
  }
  process.exit(exitCode);
}
