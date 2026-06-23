import { LOCAL_EMULATOR_ADMIN_EMAIL, LOCAL_EMULATOR_ADMIN_PASSWORD } from "@hexclave/shared/dist/local-emulator";
import { readConfigValue } from "./config.js";
import { emulatorBackendPort, emulatorDashboardPort, internalPckPath, pollInternalPck } from "./emulator-paths.js";
import { AuthError, CliError } from "./errors.js";

export const DEFAULT_API_URL = "https://api.hexclave.com";
export const DEFAULT_DASHBOARD_URL = "https://app.hexclave.com";
export const DEFAULT_PUBLISHABLE_CLIENT_KEY = process.env.STACK_CLI_PUBLISHABLE_CLIENT_KEY ?? "pck_9bbqvqsbh0gdb6smk11d71qg4ktc4rz8ya7cc69yndm7g";

export type LoginConfig = {
  apiUrl: string,
  dashboardUrl: string,
  publishableClientKey: string,
};

export type SessionAuth = LoginConfig & {
  refreshToken: string,
};

export type ProjectAuthWithRefreshToken = SessionAuth & {
  projectId: string,
};

export type ProjectAuthWithSecretServerKey = LoginConfig & {
  projectId: string,
  secretServerKey: string,
};

export type ProjectAuth = (ProjectAuthWithRefreshToken | ProjectAuthWithSecretServerKey) & {
  projectId: string,
};

function resolveApiUrl(): string {
  return resolveHexclaveStackEnvVar("HEXCLAVE_API_URL", "STACK_API_URL")
    ?? readConfigValue("STACK_API_URL")
    ?? DEFAULT_API_URL;
}

function resolveDashboardUrl(): string {
  return resolveHexclaveStackEnvVar("HEXCLAVE_DASHBOARD_URL", "STACK_DASHBOARD_URL")
    ?? readConfigValue("STACK_DASHBOARD_URL")
    ?? DEFAULT_DASHBOARD_URL;
}

function resolveRefreshToken(): string {
  const token = process.env.STACK_CLI_REFRESH_TOKEN
    ?? readConfigValue("STACK_CLI_REFRESH_TOKEN");
  if (!token) {
    throw new AuthError("Not logged in. Run `hexclave login` first.");
  }
  return token;
}

function resolveHexclaveStackEnvVar(hexclaveName: string, stackName: string): string | undefined {
  const hexclaveValue = process.env[hexclaveName];
  const stackValue = process.env[stackName];
  if (hexclaveValue && stackValue && hexclaveValue !== stackValue) {
    throw new CliError(`Environment variables ${hexclaveName} and ${stackName} are both set to different values. Remove one of them or set them to the same value.`);
  }
  return hexclaveValue || stackValue || undefined;
}

function resolveSecretServerKey(): string | null {
  return resolveHexclaveStackEnvVar("HEXCLAVE_SECRET_SERVER_KEY", "STACK_SECRET_SERVER_KEY") || null;
}

export function resolveLoginConfig(): LoginConfig {
  return {
    apiUrl: resolveApiUrl(),
    dashboardUrl: resolveDashboardUrl(),
    publishableClientKey: DEFAULT_PUBLISHABLE_CLIENT_KEY,
  };
}

export function resolveSessionAuth(): SessionAuth {
  return {
    ...resolveLoginConfig(),
    refreshToken: resolveRefreshToken(),
  };
}

export function resolveAuth(projectId: string): ProjectAuth {
  const secretServerKey = resolveSecretServerKey();
  if (secretServerKey) {
    return {
      ...resolveLoginConfig(),
      projectId,
      secretServerKey,
    };
  }

  return {
    ...resolveSessionAuth(),
    projectId,
  };
}

// Resolve the cloud project ID from the `--cloud-project-id` option, falling
// back to the HEXCLAVE_PROJECT_ID environment variable (and the legacy
// STACK_PROJECT_ID name). Empty strings are treated as absent so callers can
// pass through optional option values directly.
export function resolveProjectId(projectIdOption?: string): string {
  if (projectIdOption != null && projectIdOption !== "") {
    return projectIdOption;
  }
  const projectIdFromEnv = resolveHexclaveStackEnvVar("HEXCLAVE_PROJECT_ID", "STACK_PROJECT_ID");
  if (projectIdFromEnv != null && projectIdFromEnv !== "") {
    return projectIdFromEnv;
  }
  throw new CliError("No project ID provided. Pass --cloud-project-id <id> or set the HEXCLAVE_PROJECT_ID environment variable.");
}

export function isProjectAuthWithSecretServerKey(auth: ProjectAuth): auth is ProjectAuthWithSecretServerKey {
  return "secretServerKey" in auth;
}

export function isProjectAuthWithRefreshToken(auth: ProjectAuth): auth is ProjectAuthWithRefreshToken {
  return "refreshToken" in auth;
}

function resolveLocalEmulatorUrl(envName: "STACK_EMULATOR_API_URL" | "STACK_EMULATOR_DASHBOARD_URL", port: number): string {
  return process.env[envName]
    ?? readConfigValue(envName)
    ?? `http://127.0.0.1:${port}`;
}

export function resolveLocalEmulatorApiUrl(): string {
  return resolveLocalEmulatorUrl("STACK_EMULATOR_API_URL", emulatorBackendPort());
}

export function resolveLocalEmulatorDashboardUrl(): string {
  return resolveLocalEmulatorUrl("STACK_EMULATOR_DASHBOARD_URL", emulatorDashboardPort());
}

// Per-phase budget for waiting until the development environment is ready.
// Applied independently to (a) waiting for the PCK file to appear and (b) the
// sign-in retry loop, so the worst-case wall-clock is up to ~2× this value when
// both phases hit the deadline. Override via STACK_EMULATOR_READY_TIMEOUT_MS
// (in milliseconds).
const DEFAULT_LOCAL_EMULATOR_READY_TIMEOUT_MS = 10_000;
const LOCAL_EMULATOR_PER_REQUEST_TIMEOUT_MS = 5_000;

// Exported for unit tests. Reads the env var, validates, and returns the
// resolved timeout in milliseconds.
export function localEmulatorReadyTimeoutMs(): number {
  const raw = process.env.STACK_EMULATOR_READY_TIMEOUT_MS;
  if (!raw) return DEFAULT_LOCAL_EMULATOR_READY_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliError(`Invalid STACK_EMULATOR_READY_TIMEOUT_MS: ${raw}. Must be a non-negative integer (milliseconds).`);
  }
  return parsed;
}

async function resolveLocalEmulatorInternalPck(timeoutMs: number): Promise<string> {
  const contents = await pollInternalPck(timeoutMs);
  if (contents === null) {
    throw new AuthError(`Development environment publishable client key not found at ${internalPckPath()} (waited ${timeoutMs}ms). Start your development environment and try again.`);
  }
  return contents;
}

type SignInBody = {
  email: string,
  password: string,
};

// Retry on transport-level failures (connection refused, DNS, abort/timeout).
// HTTP errors come back as a Response with !ok and are handled separately —
// they are not retried because the emulator is reachable, just unhappy.
export function isRetryableFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  if (err.name === "AbortError" || err.name === "TimeoutError") return true;
  return err.name === "TypeError" || /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET/i.test(err.message);
}

async function attemptLocalEmulatorSignIn(apiUrl: string, internalPck: string, body: SignInBody, perRequestTimeoutMs: number): Promise<Response> {
  return await fetch(`${apiUrl}/api/v1/auth/password/sign-in`, {
    method: "POST",
    signal: AbortSignal.timeout(perRequestTimeoutMs),
    headers: {
      "Content-Type": "application/json",
      "X-Stack-Project-Id": "internal",
      "X-Stack-Access-Type": "client",
      "X-Stack-Publishable-Client-Key": internalPck,
    },
    body: JSON.stringify(body),
  });
}

async function localEmulatorSignInWithRetry(apiUrl: string, internalPck: string, body: SignInBody, totalTimeoutMs: number): Promise<Response> {
  const deadline = performance.now() + totalTimeoutMs;
  let delay = 100;
  let lastError: unknown = null;
  while (true) {
    // Cap each request so the user-set total budget is actually honored — a
    // 5s default per-request would otherwise overshoot a small total.
    const remainingForRequest = Math.max(1, deadline - performance.now());
    const perRequestTimeoutMs = Math.min(LOCAL_EMULATOR_PER_REQUEST_TIMEOUT_MS, remainingForRequest);
    try {
      return await attemptLocalEmulatorSignIn(apiUrl, internalPck, body, perRequestTimeoutMs);
    } catch (err) {
      if (!isRetryableFetchError(err)) throw err;
      lastError = err;
    }
    if (performance.now() >= deadline) {
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      throw new AuthError(`Cannot reach development environment at ${apiUrl} (after ${totalTimeoutMs}ms): ${message}. Start your development environment and try again.`);
    }
    const remaining = deadline - performance.now();
    await new Promise((r) => setTimeout(r, Math.min(delay, remaining)));
    delay = Math.min(delay * 2, 1_000);
  }
}

export async function resolveLocalEmulatorAuth(projectId: string): Promise<ProjectAuthWithRefreshToken> {
  const apiUrl = resolveLocalEmulatorApiUrl();
  const readyTimeoutMs = localEmulatorReadyTimeoutMs();
  const internalPck = await resolveLocalEmulatorInternalPck(readyTimeoutMs);

  const res = await localEmulatorSignInWithRetry(
    apiUrl,
    internalPck,
    { email: LOCAL_EMULATOR_ADMIN_EMAIL, password: LOCAL_EMULATOR_ADMIN_PASSWORD },
    readyTimeoutMs,
  );

  if (!res.ok) {
    let body: string;
    try {
      body = await res.text();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AuthError(`Development-environment sign-in failed (${res.status} ${res.statusText}). Failed to read response body: ${message}. Make sure the development environment is running with NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR=true.`);
    }
    throw new AuthError(`Development-environment sign-in failed (${res.status} ${res.statusText})${body ? `: ${body}` : ""}. Make sure the development environment is running with NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR=true.`);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AuthError(`Development-environment sign-in returned a non-JSON response: ${message}.`);
  }
  if (data === null || typeof data !== "object" || typeof (data as { refresh_token?: unknown }).refresh_token !== "string") {
    throw new AuthError("Development-environment sign-in response was missing a refresh token.");
  }
  const refreshToken = (data as { refresh_token: string }).refresh_token;

  return {
    apiUrl,
    dashboardUrl: resolveLocalEmulatorDashboardUrl(),
    publishableClientKey: internalPck,
    refreshToken,
    projectId,
  };
}
