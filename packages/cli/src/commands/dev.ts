import { execFileSync, spawn } from "child_process";
import { Command } from "commander";
import { chmodSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync, writeSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { DEFAULT_API_URL, DEFAULT_PUBLISHABLE_CLIENT_KEY, resolveLoginConfig } from "../lib/auth.js";
import { forwardSignals } from "../lib/child-process.js";
import { resolveConfigFilePathOption } from "../lib/config-file-path.js";
import { devEnvStatePath, ensureLocalDashboardSecret, readDevEnvState, recordLocalDashboardProcess } from "../lib/dev-env-state.js";
import { CliError } from "../lib/errors.js";
import { cliVersion } from "../lib/own-package.js";
import { maybeReexecToLatest } from "../lib/self-update.js";

type ChildCommand = {
  command: string,
  args: string[],
};

type DevOptions = {
  configFile?: string,
  autoUpdate?: boolean,
};

type SessionResponse = {
  session_id: string,
  env: Record<string, string>,
  project_id: string,
  onboarding_outstanding: boolean,
};

const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_STOP_POLL_MS = 100;
const DASHBOARD_RESTART_MIN_UPTIME_MS = 5_000;
const DEFAULT_DASHBOARD_PORT = 26700;
const DASHBOARD_PORT_ENV_VAR = "NEXT_PUBLIC_HEXCLAVE_LOCAL_DASHBOARD_PORT";
const DASHBOARD_START_TIMEOUT_MS = 60_000;
const DASHBOARD_STOP_TIMEOUT_MS = 10_000;
const DASHBOARD_FORCE_STOP_TIMEOUT_MS = 2_000;
const DASHBOARD_HEALTH_PATH = "/api/development-environment/health";
const BUNDLED_DASHBOARD_DIR_NAME = "dashboard";
const BUNDLED_DASHBOARD_SERVER_PATH = join("apps", "dashboard", "server.js");
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
  "NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR",
  "NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT",
  "NEXT_PUBLIC_STACK_IS_PREVIEW",
  DASHBOARD_PORT_ENV_VAR,
]);

type ProgressLogger = {
  stop: (finalMessage?: string) => void,
};

type DashboardSessionState = {
  session: SessionResponse,
  dashboardReachableSinceMs: number,
};

function wait(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function splitDevCommandArgs(commandArgs: string[]): ChildCommand {
  if (commandArgs.length === 0) {
    throw new CliError("Missing command. Usage: hexclave dev --config-file <path> -- <command> [args...]");
  }
  const command = commandArgs[0];
  return { command, args: commandArgs.slice(1) };
}

function dashboardPort(): number {
  const rawPort = process.env[DASHBOARD_PORT_ENV_VAR];
  if (rawPort == null || rawPort.length === 0) {
    return DEFAULT_DASHBOARD_PORT;
  }
  if (!/^[0-9]+$/.test(rawPort)) {
    throw new CliError(`${DASHBOARD_PORT_ENV_VAR} must be an integer between 1 and 65535.`);
  }
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new CliError(`${DASHBOARD_PORT_ENV_VAR} must be an integer between 1 and 65535.`);
  }
  return port;
}

function dashboardUrl(port = dashboardPort()): string {
  return `http://127.0.0.1:${port}`;
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

function maybeOpenOnboardingPage(session: SessionResponse, port: number): void {
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

function startProgressLog(message: string): ProgressLogger {
  if (!process.stderr.isTTY) {
    logDev(`${message}...`);
    return {
      stop() {
        logDev(`${message}... done!`);
      },
    };
  }

  let dotCount = 0;
  let stopped = false;
  const render = () => {
    process.stderr.write(`\r\x1b[2K${LOG_PREFIX}${message}${".".repeat(dotCount)}`);
    dotCount = (dotCount + 1) % 4;
  };
  render();
  const timer = setInterval(render, 400);
  timer.unref();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      process.stderr.write("\r\x1b[2K");
      logDev(`${message}... done!`);
    },
  };
}

function bundledDashboardRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), BUNDLED_DASHBOARD_DIR_NAME);
}

function assertBundledDashboardExists(): void {
  const serverPath = join(bundledDashboardRoot(), BUNDLED_DASHBOARD_SERVER_PATH);
  if (!existsSync(serverPath)) {
    throw new CliError([
      "This stack-cli build does not include the bundled development-environment dashboard.",
      "Build the CLI package with the dashboard standalone assets before running `hexclave dev`.",
    ].join(" "));
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

function prepareDashboardRuntime(env: NodeJS.ProcessEnv, port: number): string {
  assertBundledDashboardExists();
  const runtimeRoot = dashboardRuntimeRoot(port);
  mkdirSync(dirname(runtimeRoot), { recursive: true });
  rmSync(runtimeRoot, { recursive: true, force: true });
  cpSync(bundledDashboardRoot(), runtimeRoot, { recursive: true });
  replaceDashboardRuntimeSentinels(runtimeRoot, env);

  const runtimeServerPath = join(runtimeRoot, BUNDLED_DASHBOARD_SERVER_PATH);
  if (!existsSync(runtimeServerPath)) {
    throw new CliError("The bundled development-environment dashboard is missing its server entrypoint.");
  }
  return runtimeServerPath;
}

async function isDashboardReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}${DASHBOARD_HEALTH_PATH}`, {
      headers: {
        Accept: "application/json",
      },
    });
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
    // A `-` immediately after the core marks a semver prerelease (e.g.
    // 2.8.109-beta.1). `.test()` returns a plain boolean, sidestepping the
    // optional-capture-group typing.
    hasPrerelease: /^v?\d+\.\d+\.\d+-/.test(trimmed),
  };
}

// Returns true only when `candidate` is strictly newer than `current`. Unknown
// or unparseable versions return false so we never act on a version we can't
// reason about (and never downgrade). Prerelease identifiers beyond the
// "release beats same-core prerelease" rule are intentionally not ordered. Only
// the dashboard restart check below needs this; the CLI re-exec just always runs
// `@latest`. Exported for unit testing.
export function isVersionNewer(candidate: string, current: string): boolean {
  const a = parseVersionCore(candidate);
  const b = parseVersionCore(current);
  if (a == null || b == null) return false;
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) {
      return a.core[i] > b.core[i];
    }
  }
  // Same x.y.z: a final release outranks a prerelease of the same core.
  return !a.hasPrerelease && b.hasPrerelease;
}

// Restart the running dashboard only when ours is strictly newer; this is how a
// re-exec'd `npx @latest` rolls out a fresh dashboard without a reinstall.
// Equal/older/unknown versions (e.g. a dashboard recorded by a pre-feature CLI
// with no version field) are reused as-is. Exported for unit testing.
export function shouldRestartDashboard(currentVersion: string | undefined, runningVersion: string | undefined): boolean {
  return currentVersion != null && runningVersion != null && isVersionNewer(currentVersion, runningVersion);
}

// Whether `pid` refers to a live process. EPERM means it exists but is owned by
// another user — i.e. the pid was recycled onto something that isn't ours.
export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Terminate the background dashboard recorded for `port` in dev-env state and
// wait until the port stops answering, so a fresh (newer) dashboard can rebind
// without EADDRINUSE.
export async function killLocalDashboard(url: string, port: number): Promise<void> {
  const pid = readDevEnvState().localDashboardsByPort?.[String(port)]?.pid;
  if (pid == null || pid <= 0) return;
  if (!processExists(pid)) return;

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ESRCH: already gone. EPERM: the pid was recycled onto a process we don't
    // own, so it isn't our dashboard — don't wait on it or escalate to SIGKILL.
    if (code === "ESRCH" || code === "EPERM") return;
    throw error;
  }

  // Wait for the port to be released — that's the property that actually lets
  // the replacement bind. Don't gate on the pid: once the dashboard exits its
  // pid can be recycled onto an unrelated same-user process, which a pid probe
  // would misreport as "still alive" (spinning the full timeout and then
  // mis-targeting the SIGKILL below). isDashboardReachable only succeeds while
  // the listener is up, so an unreachable port reliably means it's gone.
  const startedAt = performance.now();
  while (performance.now() - startedAt < DASHBOARD_STOP_TIMEOUT_MS) {
    if (!(await isDashboardReachable(url))) return;
    await wait(200);
  }

  // Still listening after the grace period — the process is genuinely hung and
  // still holding the port, so the recorded pid is necessarily still valid;
  // force it down, then wait for the socket to be released.
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // best-effort
  }
  const killDeadline = performance.now() + DASHBOARD_FORCE_STOP_TIMEOUT_MS;
  while (performance.now() < killDeadline) {
    if (!(await isDashboardReachable(url))) return;
    await wait(200);
  }
}

async function startDashboardIfNeeded(options: { apiBaseUrl: string, secret: string, port: number }): Promise<void> {
  const url = dashboardUrl(options.port);
  if (await isDashboardReachable(url)) {
    const currentVersion = cliVersion();
    const runningVersion = readDevEnvState().localDashboardsByPort?.[String(options.port)]?.version;
    if (shouldRestartDashboard(currentVersion, runningVersion)) {
      logDev(`Existing Hexclave dashboard is ${runningVersion}; restarting with ${currentVersion}...`);
      await killLocalDashboard(url, options.port);
    } else {
      logDev(`Using existing Hexclave dashboard on ${url}.`);
      return;
    }
  }

  const progress = startProgressLog(`Hexclave dashboard not found on port ${options.port}. Starting now`);
  const dashboardEnv = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(options.port),
    HOSTNAME: "127.0.0.1",
    STACK_API_URL: options.apiBaseUrl,
    NEXT_PUBLIC_STACK_API_URL: options.apiBaseUrl,
    NEXT_PUBLIC_BROWSER_STACK_API_URL: options.apiBaseUrl,
    NEXT_PUBLIC_SERVER_STACK_API_URL: options.apiBaseUrl,
    NEXT_PUBLIC_STACK_DASHBOARD_URL: url,
    NEXT_PUBLIC_BROWSER_STACK_DASHBOARD_URL: url,
    NEXT_PUBLIC_SERVER_STACK_DASHBOARD_URL: url,
    NEXT_PUBLIC_STACK_PROJECT_ID: "internal",
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: DEFAULT_PUBLISHABLE_CLIENT_KEY,
    NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR: "false",
    NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT: "true",
    NEXT_PUBLIC_STACK_IS_PREVIEW: "false",
    [DASHBOARD_PORT_ENV_VAR]: String(options.port),
  };
  try {
    const dashboardServerPath = prepareDashboardRuntime(dashboardEnv, options.port);
    const logPath = dashboardLogPath(options.port);
    mkdirSync(dirname(logPath), { recursive: true });
    const logFd = openSync(logPath, "a", 0o600);
    chmodSync(logPath, 0o600);
    writeSync(logFd, `\n[${new Date().toISOString()}] Starting Hexclave development-environment dashboard on ${url}\n`);
    const child = (() => {
      try {
        return spawn(process.execPath, [dashboardServerPath], {
          cwd: resolve(dirname(dashboardServerPath), "../.."),
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: dashboardEnv,
        });
      } finally {
        closeSync(logFd);
      }
    })();
    if (child.pid == null) {
      throw new CliError(`Failed to start the development environment dashboard process. Dashboard logs: ${logPath}`);
    }
    recordLocalDashboardProcess(options.port, options.secret, child.pid, logPath, cliVersion());
    child.unref();

    const startedAt = performance.now();
    while (performance.now() - startedAt < DASHBOARD_START_TIMEOUT_MS) {
      if (await isDashboardReachable(url)) {
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

async function dashboardRequest(path: string, options: RequestInit, secret: string, port: number): Promise<Response> {
  const url = `${dashboardUrl(port)}${path}`;
  try {
    return await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${secret}`,
        ...options.headers,
      },
    });
  } catch (error) {
    throw new CliError(`Failed to reach local Hexclave dashboard at ${url}: ${errorMessage(error)}`);
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function responseErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (text.length === 0) return "empty response body";

  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed)) {
      const error = parsed.error;
      if (typeof error === "string") return error;
      if (isRecord(error) && typeof error.message === "string") return error.message;
    }
  } catch {
    // Fall back to the raw response below.
  }

  return text;
}

function isSessionResponse(value: unknown): value is SessionResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "session_id" in value &&
    typeof value.session_id === "string" &&
    "project_id" in value &&
    typeof value.project_id === "string" &&
    "onboarding_outstanding" in value &&
    typeof value.onboarding_outstanding === "boolean" &&
    "env" in value &&
    isStringRecord(value.env)
  );
}

async function createRemoteDevelopmentEnvironmentSession(options: {
  apiBaseUrl: string,
  configFilePath: string,
  port: number,
  secret: string,
}): Promise<SessionResponse> {
  const response = await dashboardRequest("/api/remote-development-environment/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_base_url: options.apiBaseUrl,
      config_path: options.configFilePath,
    }),
  }, options.secret, options.port);
  if (!response.ok) {
    throw new CliError(`Failed to register development environment session (${response.status}): ${await responseErrorMessage(response)}`);
  }
  const body: unknown = await response.json();
  if (!isSessionResponse(body)) {
    throw new CliError("Local dashboard returned an invalid development environment session response.");
  }
  return body;
}

function runChildProcess(command: ChildCommand, env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command.command, command.args, { stdio: "inherit", env });
    const cleanup = forwardSignals(child);
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
}): Promise<SessionResponse> {
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
  while (!options.shouldStop()) {
    if (await waitForHeartbeatIntervalOrStop(options.shouldStop)) return;

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
    } catch {
      if (options.shouldStop()) return;
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
    }
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

export function registerDevCommand(program: Command) {
  program
    .command("dev")
    .usage("--config-file <path> -- <command> [args...]")
    .description("Run a command with Hexclave development-environment credentials")
    .requiredOption("--config-file <path>", "Path to stack.config.ts")
    .option("--no-auto-update", "Don't re-run the latest published CLI via npx before starting")
    .argument("<command...>", "Command and arguments to run after --")
    .action(async (commandArgs: string[], opts: DevOptions) => {
      if (opts.configFile == null) {
        throw new CliError("--config-file is required.");
      }

      // Before doing any work, re-exec through `npx <pkg>@latest` when a newer
      // CLI is published so users get the latest dashboard without reinstalling.
      // No-ops (and returns) when already latest, offline, in CI, or opted out.
      if (opts.autoUpdate !== false) {
        await maybeReexecToLatest({
          forwardArgs: ["dev", "--config-file", opts.configFile, "--", ...commandArgs],
        });
      }

      const childCommand = splitDevCommandArgs(commandArgs);
      const port = dashboardPort();
      const localDashboardUrl = dashboardUrl(port);
      const secret = ensureLocalDashboardSecret(port);
      const config = resolveLoginConfig();
      const apiBaseUrl = normalizeApiBaseUrl(config.apiUrl || DEFAULT_API_URL);
      const configFilePath = resolveConfigFilePathOption(opts.configFile, { mustExist: false });
      await startDashboardIfNeeded({ apiBaseUrl, secret, port });
      const sessionState: DashboardSessionState = {
        session: await createRemoteDevelopmentEnvironmentSession({
          apiBaseUrl,
          configFilePath,
          port,
          secret,
        }),
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
      let exitCode = 1;
      try {
        exitCode = await runChildProcess(childCommand, {
          ...process.env,
          ...sessionState.session.env,
        });
      } finally {
        stopped = true;
        await heartbeat;
        await closeSession(sessionState.session.session_id, secret, port);
      }
      process.exit(exitCode);
    });
}
