import { DEFAULT_API_URL } from "./auth.js";
import { CliError } from "./errors.js";

export const DEFAULT_DASHBOARD_PORT = 26700;
export const DASHBOARD_PORT_ENV_VAR = "NEXT_PUBLIC_HEXCLAVE_LOCAL_DASHBOARD_PORT";

export type DashboardSessionResponse = {
  session_id: string,
  env: Record<string, string>,
  project_id: string,
  onboarding_outstanding: boolean,
};

export function dashboardPort(): number {
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

export function dashboardUrl(port = dashboardPort()): string {
  return `http://127.0.0.1:${port}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function dashboardRequest(path: string, options: RequestInit, secret: string, port: number): Promise<Response> {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function responseErrorMessage(response: Response): Promise<string> {
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

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function isDashboardSessionResponse(value: unknown): value is DashboardSessionResponse {
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

export async function createRemoteDevelopmentEnvironmentSession(options: {
  apiBaseUrl?: string,
  configFilePath: string,
  port: number,
  secret: string,
}): Promise<DashboardSessionResponse> {
  const response = await dashboardRequest("/api/remote-development-environment/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_base_url: options.apiBaseUrl ?? DEFAULT_API_URL,
      config_path: options.configFilePath,
    }),
  }, options.secret, options.port);
  if (!response.ok) {
    throw new CliError(`Failed to register development environment session (${response.status}): ${await responseErrorMessage(response)}`);
  }
  const body: unknown = await response.json();
  if (!isDashboardSessionResponse(body)) {
    throw new CliError("Local dashboard returned an invalid development environment session response.");
  }
  return body;
}

export async function closeRemoteDevelopmentEnvironmentSession(sessionId: string, secret: string, port: number): Promise<Response> {
  return await dashboardRequest(`/api/remote-development-environment/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  }, secret, port);
}
