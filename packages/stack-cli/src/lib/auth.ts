import { readConfigValue } from "./config.js";
import { AuthError } from "./errors.js";

export const DEFAULT_API_URL = "https://api.stack-auth.com";
export const DEFAULT_DASHBOARD_URL = "https://app.stack-auth.com";
export const DEFAULT_PUBLISHABLE_CLIENT_KEY = "pck_6ypt981excjnk24dmgx5703my25k2f3y2z3qjhbykz3q0";

type Flags = {
  projectId?: string,
  apiUrl?: string,
  dashboardUrl?: string,
};

export type LoginConfig = {
  apiUrl: string,
  dashboardUrl: string,
};

export type SessionAuth = LoginConfig & {
  refreshToken: string,
};

export type ProjectAuth = SessionAuth & {
  projectId: string,
};

function resolveApiUrl(flags: Flags): string {
  return flags.apiUrl
    ?? process.env.STACK_API_URL
    ?? readConfigValue("STACK_API_URL")
    ?? DEFAULT_API_URL;
}

function resolveDashboardUrl(flags: Flags): string {
  return flags.dashboardUrl
    ?? process.env.STACK_DASHBOARD_URL
    ?? readConfigValue("STACK_DASHBOARD_URL")
    ?? DEFAULT_DASHBOARD_URL;
}

function resolveRefreshToken(): string {
  const token = process.env.STACK_CLI_REFRESH_TOKEN
    ?? readConfigValue("STACK_CLI_REFRESH_TOKEN");
  if (!token) {
    throw new AuthError("Not logged in. Run `stack login` first.");
  }
  return token;
}

function resolveProjectId(flags: Flags): string {
  const projectId = flags.projectId ?? process.env.STACK_PROJECT_ID;
  if (!projectId) {
    throw new AuthError("No project ID specified. Use --project-id or set STACK_PROJECT_ID.");
  }
  return projectId;
}

export function resolveLoginConfig(flags: Flags): LoginConfig {
  return {
    apiUrl: resolveApiUrl(flags),
    dashboardUrl: resolveDashboardUrl(flags),
  };
}

export function resolveSessionAuth(flags: Flags): SessionAuth {
  return {
    ...resolveLoginConfig(flags),
    refreshToken: resolveRefreshToken(),
  };
}

export function resolveAuth(flags: Flags): ProjectAuth {
  return {
    ...resolveSessionAuth(flags),
    projectId: resolveProjectId(flags),
  };
}
