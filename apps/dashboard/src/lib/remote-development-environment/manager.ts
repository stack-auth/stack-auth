import "server-only";

import { getPublicEnvVar } from "@/lib/env";
import { hexclaveAppInternalsSymbol } from "@/lib/hexclave-app-internals";
import { AdminOwnedProject, StackClientApp } from "@hexclave/next";
import { Config, override } from "@hexclave/shared/dist/config/format";
import { ProjectOnboardingStatus } from "@hexclave/shared/dist/schema-fields";
import { AccessToken } from "@hexclave/shared/dist/sessions";
import { errorToNiceString } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { randomUUID } from "crypto";
import { watch, type FSWatcher } from "fs";
import { basename, dirname } from "path";
import { peekRemoteDevelopmentEnvironmentBrowserSecretConfirmationCodeForCli } from "./browser-secret";
import {
  ensureConfigFileExists,
  readConfigFile,
  resolveConfigFilePath,
  sha256String,
  writeConfigObject,
} from "./config-file";
import { assertRemoteDevelopmentEnvironmentEnabled } from "./env";
import {
  RemoteDevelopmentEnvironmentProject,
  readRemoteDevelopmentEnvironmentState,
  updateRemoteDevelopmentEnvironmentState,
} from "./state";

const SESSION_TTL_MS = 25_000;
const FIRST_HEARTBEAT_TTL_MS = 5 * 60_000;
const STARTUP_EMPTY_SESSION_GRACE_MS = 20_000;
const SYNC_DEBOUNCE_MS = 500;
const CONFIG_SYNC_FORMAT_VERSION = 2;
const LOG_PREFIX = "[Stack RDE]";

export class RemoteDevelopmentEnvironmentApiUnavailableError extends Error {
  constructor(apiBaseUrl: string, cause: unknown) {
    super(`Could not connect to the Hexclave API at ${apiBaseUrl}. Make sure the backend for this development environment is running and reachable.`, { cause });
    this.name = "RemoteDevelopmentEnvironmentApiUnavailableError";
  }
}

type ActiveSession = {
  configFilePath: string,
  lastHeartbeatMs: number,
  receivedFirstHeartbeat: boolean,
};

type RemoteDevelopmentEnvironmentDebugSession = {
  sessionId: string,
  configFilePath: string,
  lastHeartbeatAgeMs: number,
  ttlMs: number,
  expiresInMs: number,
  receivedFirstHeartbeat: boolean,
};

type RemoteDevelopmentEnvironmentDebugSnapshot = {
  uptimeMs: number,
  shutdownTimerStarted: boolean,
  activeOperations: number,
  hasClosedSession: boolean,
  sessions: RemoteDevelopmentEnvironmentDebugSession[],
  watchedConfigFiles: string[],
  pendingSyncConfigFiles: string[],
  syncErrors: { configFilePath: string, error: string }[],
  synchronouslyUpdatingConfigFiles: string[],
  localDashboards: {
    port: number,
    pid: number,
    startedAgoMs: number,
    logPath?: string,
  }[],
  pendingBrowserSecretConfirmationCodes: {
    port: string,
    code: string,
    expiresInMs: number,
    updatedAgoMs: number,
  }[],
  projects: {
    configFilePath: string,
    projectId: string,
    teamId: string,
    apiBaseUrl: string,
    updatedAgoMs: number,
    hasLastSyncedConfigHash: boolean,
  }[],
};

type RemoteDevelopmentEnvironmentGlobals = {
  sessions: Map<string, ActiveSession>,
  watchers: Map<string, FSWatcher>,
  syncTimers: Map<string, NodeJS.Timeout>,
  syncErrors: Map<string, Error>,
  synchronouslyUpdatingConfigFiles: Set<string>,
  shutdownTimerStarted: boolean,
  startedAtMs: number,
  activeOperations: number,
  hasClosedSession: boolean,
};

type HexclaveAppRequestInternals = {
  sendRequest: (path: string, requestOptions: RequestInit, requestType?: "client" | "server" | "admin") => Promise<Response>,
};

const globals = globalThis as typeof globalThis & {
  __stackRemoteDevelopmentEnvironment?: RemoteDevelopmentEnvironmentGlobals,
};

function getGlobals(): RemoteDevelopmentEnvironmentGlobals {
  assertRemoteDevelopmentEnvironmentEnabled();
  globals.__stackRemoteDevelopmentEnvironment ??= {
    sessions: new Map(),
    watchers: new Map(),
    syncTimers: new Map(),
    syncErrors: new Map(),
    synchronouslyUpdatingConfigFiles: new Set(),
    shutdownTimerStarted: false,
    startedAtMs: performance.now(),
    activeOperations: 0,
    hasClosedSession: false,
  };
  return globals.__stackRemoteDevelopmentEnvironment;
}

function logRemoteDevelopmentEnvironment(message: string, details?: Record<string, unknown>): void {
  if (details == null) {
    console.log(`${LOG_PREFIX} ${message}`);
    return;
  }
  console.log(`${LOG_PREFIX} ${message}`, details);
}

function warnRemoteDevelopmentEnvironment(message: string, details?: Record<string, unknown>): void {
  if (details == null) {
    console.warn(`${LOG_PREFIX} ${message}`);
    return;
  }
  console.warn(`${LOG_PREFIX} ${message}`, details);
}

function errorLooksLikeApiConnectionFailure(error: unknown): boolean {
  const message = errorToNiceString(error);
  return (
    message.includes("ECONNREFUSED")
    || message.includes("ECONNRESET")
    || message.includes("ETIMEDOUT")
    || message.includes("ENOTFOUND")
    || message.includes("fetch failed")
  );
}

function throwApiUnavailableIfConnectionFailure(apiBaseUrl: string, error: unknown): never {
  if (errorLooksLikeApiConnectionFailure(error)) {
    throw new RemoteDevelopmentEnvironmentApiUnavailableError(apiBaseUrl, error);
  }
  throw error;
}

function isStackAppRequestInternals(value: unknown): value is HexclaveAppRequestInternals {
  return (
    value != null &&
    typeof value === "object" &&
    "sendRequest" in value &&
    typeof value.sendRequest === "function"
  );
}

function getStackAppRequestInternals(appValue: unknown): HexclaveAppRequestInternals {
  if (appValue == null || typeof appValue !== "object") {
    throw new Error("The Stack app instance is unavailable.");
  }

  const internals = Reflect.get(appValue, hexclaveAppInternalsSymbol);
  if (!isStackAppRequestInternals(internals)) {
    throw new Error("The Stack app cannot send remote development environment onboarding updates.");
  }

  return internals;
}

function beginRemoteDevelopmentEnvironmentOperation(name: string, details?: Record<string, unknown>): () => void {
  const state = getGlobals();
  state.activeOperations += 1;
  logRemoteDevelopmentEnvironment(`Started ${name}`, {
    ...details,
    activeOperations: state.activeOperations,
  });

  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    state.activeOperations -= 1;
    logRemoteDevelopmentEnvironment(`Finished ${name}`, {
      ...details,
      activeOperations: state.activeOperations,
    });
  };
}

function internalPublishableClientKey(): string {
  const key = process.env.STACK_CLI_PUBLISHABLE_CLIENT_KEY ?? getPublicEnvVar("NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY");
  if (key == null || key.length === 0) {
    throw new Error("Missing internal publishable client key for remote development environment dashboard.");
  }
  return key;
}

function createInternalApp(apiBaseUrl: string, anonymousRefreshToken?: string) {
  return new StackClientApp({
    projectId: "internal",
    publishableClientKey: internalPublishableClientKey(),
    baseUrl: apiBaseUrl,
    tokenStore: anonymousRefreshToken == null ? "memory" : { refreshToken: anonymousRefreshToken, accessToken: "" },
    noAutomaticPrefetch: true,
  });
}

function envVarsForProject(project: RemoteDevelopmentEnvironmentProject): Record<string, string> {
  return {
    STACK_PROJECT_ID: project.projectId,
    NEXT_PUBLIC_STACK_PROJECT_ID: project.projectId,
    VITE_STACK_PROJECT_ID: project.projectId,
    EXPO_PUBLIC_STACK_PROJECT_ID: project.projectId,
    STACK_PUBLISHABLE_CLIENT_KEY: project.publishableClientKey,
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: project.publishableClientKey,
    VITE_STACK_PUBLISHABLE_CLIENT_KEY: project.publishableClientKey,
    EXPO_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: project.publishableClientKey,
    STACK_SECRET_SERVER_KEY: project.secretServerKey,
    STACK_API_URL: project.apiBaseUrl,
    NEXT_PUBLIC_STACK_API_URL: project.apiBaseUrl,
    VITE_STACK_API_URL: project.apiBaseUrl,
    EXPO_PUBLIC_STACK_API_URL: project.apiBaseUrl,
  };
}

async function getOrCreateProject(options: {
  apiBaseUrl: string,
  configFilePath: string,
  anonymousRefreshToken?: string,
}): Promise<{ anonymousRefreshToken: string, project: RemoteDevelopmentEnvironmentProject }> {
  logRemoteDevelopmentEnvironment("Ensuring development-environment project exists", {
    apiBaseUrl: options.apiBaseUrl,
    configFilePath: options.configFilePath,
    hasExistingAnonymousSession: options.anonymousRefreshToken != null,
  });
  const app = createInternalApp(options.apiBaseUrl, options.anonymousRefreshToken);
  const user = await app.getUser({ or: "anonymous" });
  const authJson = await user.getAuthJson();
  const anonymousRefreshToken = authJson.refreshToken ?? (() => {
    throw new Error("Anonymous session did not return a refresh token.");
  })();

  const state = readRemoteDevelopmentEnvironmentState();
  const storedProject = state.projectsByConfigPath[options.configFilePath];
  const ownedProjects = await user.listOwnedProjects();
  const existingProject = storedProject == null
    ? undefined
    : ownedProjects.find((project) => project.id === storedProject.projectId);
  if (storedProject != null && existingProject != null) {
    const updatedProject = {
      ...storedProject,
      apiBaseUrl: options.apiBaseUrl,
      updatedAtMillis: Date.now(),
    };
    updateRemoteDevelopmentEnvironmentState((current) => ({
      ...current,
      anonymousRefreshToken,
      anonymousApiBaseUrl: options.apiBaseUrl,
      projectsByConfigPath: {
        ...current.projectsByConfigPath,
        [options.configFilePath]: updatedProject,
      },
    }));
    logRemoteDevelopmentEnvironment("Reusing stored development-environment project", {
      projectId: updatedProject.projectId,
      teamId: updatedProject.teamId,
      configFilePath: options.configFilePath,
    });
    return { anonymousRefreshToken, project: updatedProject };
  }

  const label = basename(dirname(options.configFilePath)) || "Project";
  logRemoteDevelopmentEnvironment("Creating new development-environment team and project", {
    label,
    configFilePath: options.configFilePath,
  });
  const team = await user.createTeam({
    displayName: `Development Environment: ${label}`,
  });
  const project = await user.createProject({
    displayName: "Development Environment Project",
    description: `Development environment for ${label}`,
    teamId: team.id,
    isProductionMode: false,
    isDevelopmentEnvironment: true,
  });
  const key = await project.app.createInternalApiKey({
    description: `Development environment key for ${label}`,
    expiresAt: new Date("2099-12-31T23:59:59Z"),
    hasPublishableClientKey: true,
    hasSecretServerKey: true,
    hasSuperSecretAdminKey: false,
  });
  if (key.publishableClientKey == null || key.secretServerKey == null) {
    throw new Error("Development environment API key response did not include the expected keys.");
  }

  const mappedProject: RemoteDevelopmentEnvironmentProject = {
    projectId: project.id,
    teamId: team.id,
    publishableClientKey: key.publishableClientKey,
    secretServerKey: key.secretServerKey,
    apiBaseUrl: options.apiBaseUrl,
    updatedAtMillis: Date.now(),
  };
  logRemoteDevelopmentEnvironment("Created development-environment project", {
    projectId: mappedProject.projectId,
    teamId: mappedProject.teamId,
    configFilePath: options.configFilePath,
  });
  updateRemoteDevelopmentEnvironmentState((current) => ({
    ...current,
    anonymousRefreshToken,
    anonymousApiBaseUrl: options.apiBaseUrl,
    projectsByConfigPath: {
      ...current.projectsByConfigPath,
      [options.configFilePath]: mappedProject,
    },
  }));
  return { anonymousRefreshToken, project: mappedProject };
}

export async function getRemoteDevelopmentEnvironmentAccessToken(): Promise<{ accessToken: string, expiresAtMillis: number, issuedAtMillis: number, userId: string }> {
  const state = readRemoteDevelopmentEnvironmentState();
  if (state.anonymousRefreshToken == null) {
    throw new Error("Remote development environment has no anonymous session yet.");
  }

  const apiBaseUrl = state.anonymousApiBaseUrl ?? Object.values(state.projectsByConfigPath)[0]?.apiBaseUrl;
  if (apiBaseUrl == null) {
    throw new Error("Remote development environment has no API base URL yet.");
  }

  const app = createInternalApp(apiBaseUrl, state.anonymousRefreshToken);
  const user = await app.getUser({ or: "anonymous" });
  const accessToken = (await user.getAuthJson()).accessToken ?? (() => {
    throw new Error("Remote development environment anonymous session did not return an access token.");
  })();
  const parsedAccessToken = AccessToken.createIfValid(accessToken) ?? (() => {
    throw new Error("Remote development environment anonymous session returned an invalid access token.");
  })();

  return {
    accessToken,
    expiresAtMillis: parsedAccessToken.expiresAt.getTime(),
    issuedAtMillis: parsedAccessToken.issuedAt.getTime(),
    userId: user.id,
  };
}

async function syncRemoteDevelopmentEnvironmentOnboardingStatus(
  project: AdminOwnedProject,
  showOnboarding: boolean,
): Promise<ProjectOnboardingStatus> {
  const onboardingStatus = showOnboarding && project.onboardingStatus === "completed"
    ? "config_choice"
    : showOnboarding
      ? project.onboardingStatus
      : "completed";

  const body = showOnboarding
    ? { onboarding_status: onboardingStatus }
    : { onboarding_status: onboardingStatus, onboarding_state: null };
  const response = await getStackAppRequestInternals(project.app).sendRequest(
    "/internal/projects/current",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    "admin",
  );
  if (!response.ok) {
    throw new Error(`Failed to sync development-environment project onboarding status (${response.status}): ${await response.text()}`);
  }

  return onboardingStatus;
}

async function syncConfigToRemote(configFilePath: string): Promise<ProjectOnboardingStatus | undefined> {
  const state = readRemoteDevelopmentEnvironmentState();
  const project = state.projectsByConfigPath[configFilePath];
  if (project == null || state.anonymousRefreshToken == null) {
    warnRemoteDevelopmentEnvironment("Skipping config sync because local state is incomplete", {
      configFilePath,
      hasProject: project != null,
      hasAnonymousRefreshToken: state.anonymousRefreshToken != null,
    });
    return undefined;
  }

  const { config, showOnboarding } = await readConfigFile(configFilePath);
  const configHash = sha256String(JSON.stringify({ config, showOnboarding, syncFormatVersion: CONFIG_SYNC_FORMAT_VERSION }));
  const app = createInternalApp(project.apiBaseUrl, state.anonymousRefreshToken);
  const user = await app.getUser({ or: "anonymous" });
  const ownedProject = (await user.listOwnedProjects()).find((p) => p.id === project.projectId);
  if (ownedProject == null) {
    warnRemoteDevelopmentEnvironment("Skipping config sync because the project is not owned by the anonymous user", {
      projectId: project.projectId,
      configFilePath,
    });
    return undefined;
  }
  const onboardingStatus = await syncRemoteDevelopmentEnvironmentOnboardingStatus(ownedProject, showOnboarding);
  if (project.lastSyncedConfigHash === configHash) {
    return onboardingStatus;
  }

  logRemoteDevelopmentEnvironment("Syncing config to development-environment project", {
    projectId: project.projectId,
    configFilePath,
    showOnboarding,
  });
  await ownedProject.replaceConfigOverride("branch", config);

  updateRemoteDevelopmentEnvironmentState((current) => ({
    ...current,
    projectsByConfigPath: {
      ...current.projectsByConfigPath,
      [configFilePath]: {
        ...project,
        lastSyncedConfigHash: configHash,
        updatedAtMillis: Date.now(),
      },
    },
  }));
  logRemoteDevelopmentEnvironment("Synced config to development-environment project", {
    projectId: project.projectId,
    configFilePath,
    showOnboarding,
    onboardingStatus,
  });
  return onboardingStatus;
}

function scheduleSync(configFilePath: string): void {
  const state = getGlobals();
  if (state.synchronouslyUpdatingConfigFiles.has(configFilePath)) {
    logRemoteDevelopmentEnvironment("Skipping async config sync during synchronous dashboard update", {
      configFilePath,
    });
    return;
  }
  const existing = state.syncTimers.get(configFilePath);
  if (existing != null) clearTimeout(existing);
  logRemoteDevelopmentEnvironment("Scheduling config sync after local file change", {
    configFilePath,
    debounceMs: SYNC_DEBOUNCE_MS,
  });
  const timer = setTimeout(() => {
    state.syncTimers.delete(configFilePath);
    runAsynchronously(
      async () => {
        await syncConfigToRemote(configFilePath);
        state.syncErrors.delete(configFilePath);
      },
      {
        onError: (error) => {
          warnRemoteDevelopmentEnvironment("Config sync failed", {
            configFilePath,
            error: errorToNiceString(error),
          });
          state.syncErrors.set(configFilePath, error);
        },
      },
    );
  }, SYNC_DEBOUNCE_MS);
  timer.unref();
  state.syncTimers.set(configFilePath, timer);
}

async function syncConfigToRemoteNow(configFilePath: string): Promise<ProjectOnboardingStatus | undefined> {
  const state = getGlobals();
  const pendingTimer = state.syncTimers.get(configFilePath);
  if (pendingTimer != null) {
    clearTimeout(pendingTimer);
    state.syncTimers.delete(configFilePath);
  }
  const onboardingStatus = await syncConfigToRemote(configFilePath);
  state.syncErrors.delete(configFilePath);
  return onboardingStatus;
}

function ensureWatcher(configFilePath: string): void {
  const state = getGlobals();
  if (state.watchers.has(configFilePath)) return;
  const watcher = watch(configFilePath, { persistent: false }, () => {
    scheduleSync(configFilePath);
  });
  state.watchers.set(configFilePath, watcher);
  logRemoteDevelopmentEnvironment("Started watching config file", {
    configFilePath,
    watchedConfigFiles: state.watchers.size,
  });
}

function ensureShutdownTimer(): void {
  const state = getGlobals();
  if (state.shutdownTimerStarted) return;
  state.shutdownTimerStarted = true;
  logRemoteDevelopmentEnvironment("Started shutdown timer", {
    sessionTtlMs: SESSION_TTL_MS,
    startupEmptySessionGraceMs: STARTUP_EMPTY_SESSION_GRACE_MS,
  });
  const timer = setInterval(() => {
    const now = performance.now();
    for (const [id, session] of state.sessions.entries()) {
      const ttlMs = session.receivedFirstHeartbeat ? SESSION_TTL_MS : FIRST_HEARTBEAT_TTL_MS;
      if (now - session.lastHeartbeatMs > ttlMs) {
        warnRemoteDevelopmentEnvironment("Expiring stale session", {
          sessionId: id,
          ageMs: Math.round(now - session.lastHeartbeatMs),
          activeSessionsBeforeExpire: state.sessions.size,
          receivedFirstHeartbeat: session.receivedFirstHeartbeat,
        });
        state.sessions.delete(id);
      }
    }
    if (state.sessions.size === 0 && state.activeOperations === 0 && (state.hasClosedSession || now - state.startedAtMs > STARTUP_EMPTY_SESSION_GRACE_MS)) {
      logRemoteDevelopmentEnvironment("No active sessions remain; shutting down local dashboard", {
        uptimeMs: Math.round(now - state.startedAtMs),
        watchedConfigFiles: state.watchers.size,
        pendingSyncs: state.syncTimers.size,
        syncErrors: state.syncErrors.size,
        activeOperations: state.activeOperations,
        hasClosedSession: state.hasClosedSession,
      });
      for (const watcher of state.watchers.values()) watcher.close();
      process.exit(0);
    }
  }, 5_000);
  timer.unref();
}

export function startRemoteDevelopmentEnvironmentLifecycle(): void {
  assertRemoteDevelopmentEnvironmentEnabled();
  if (getGlobals().shutdownTimerStarted) return;
  logRemoteDevelopmentEnvironment("Starting local dashboard lifecycle");
  ensureShutdownTimer();
}

export async function registerRemoteDevelopmentEnvironmentSession(options: {
  apiBaseUrl: string,
  configPath: string,
}): Promise<{ sessionId: string, env: Record<string, string>, projectId: string, onboardingOutstanding: boolean }> {
  assertRemoteDevelopmentEnvironmentEnabled();
  startRemoteDevelopmentEnvironmentLifecycle();
  const configFilePath = resolveConfigFilePath(options.configPath);
  const endOperation = beginRemoteDevelopmentEnvironmentOperation("session registration", {
    apiBaseUrl: options.apiBaseUrl,
    configFilePath,
  });
  try {
    logRemoteDevelopmentEnvironment("Registering CLI session", {
      apiBaseUrl: options.apiBaseUrl,
      configFilePath,
    });
    ensureConfigFileExists(configFilePath);
    const state = readRemoteDevelopmentEnvironmentState();
    const { project } = await getOrCreateProject({
      apiBaseUrl: options.apiBaseUrl,
      configFilePath,
      anonymousRefreshToken: state.anonymousRefreshToken,
    }).catch((error: unknown) => throwApiUnavailableIfConnectionFailure(options.apiBaseUrl, error));
    ensureWatcher(configFilePath);
    const onboardingStatus = await syncConfigToRemoteNow(configFilePath)
      .catch((error: unknown) => throwApiUnavailableIfConnectionFailure(options.apiBaseUrl, error));
    const sessionId = randomUUID();
    getGlobals().sessions.set(sessionId, {
      configFilePath,
      lastHeartbeatMs: performance.now(),
      receivedFirstHeartbeat: false,
    });
    logRemoteDevelopmentEnvironment("Registered CLI session", {
      sessionId,
      projectId: project.projectId,
      activeSessions: getGlobals().sessions.size,
      configFilePath,
    });
    return {
      sessionId,
      env: envVarsForProject(project),
      projectId: project.projectId,
      onboardingOutstanding: onboardingStatus != null && onboardingStatus !== "completed",
    };
  } finally {
    endOperation();
  }
}

export function heartbeatRemoteDevelopmentEnvironmentSession(sessionId: string): boolean {
  assertRemoteDevelopmentEnvironmentEnabled();
  const session = getGlobals().sessions.get(sessionId);
  if (session == null) {
    warnRemoteDevelopmentEnvironment("Received heartbeat for unknown session", {
      sessionId,
    });
    return false;
  }
  session.lastHeartbeatMs = performance.now();
  session.receivedFirstHeartbeat = true;
  return true;
}

export function getPendingRemoteDevelopmentEnvironmentBrowserSecretConfirmationCode(): { code: string, expiresAtMillis: number } | null {
  assertRemoteDevelopmentEnvironmentEnabled();
  return peekRemoteDevelopmentEnvironmentBrowserSecretConfirmationCodeForCli();
}

export function closeRemoteDevelopmentEnvironmentSession(sessionId: string): void {
  assertRemoteDevelopmentEnvironmentEnabled();
  const state = getGlobals();
  const existed = state.sessions.delete(sessionId);
  if (existed) {
    state.hasClosedSession = true;
  }
  logRemoteDevelopmentEnvironment("Closed CLI session", {
    sessionId,
    existed,
    activeSessions: state.sessions.size,
  });
}

export function getRemoteDevelopmentEnvironmentHealth(): {
  healthy: boolean,
  configFilePath?: string,
} {
  assertRemoteDevelopmentEnvironmentEnabled();
  const globals = getGlobals();
  const activeSession = globals.sessions.values().next().value as ActiveSession | undefined;
  if (activeSession != null) {
    return {
      healthy: true,
      configFilePath: activeSession.configFilePath,
    };
  }

  const state = readRemoteDevelopmentEnvironmentState();
  let configFilePath: string | undefined;
  let latestUpdatedAtMillis = -Infinity;
  for (const [projectConfigFilePath, project] of Object.entries(state.projectsByConfigPath)) {
    if (project == null || project.updatedAtMillis <= latestUpdatedAtMillis) continue;
    configFilePath = projectConfigFilePath;
    latestUpdatedAtMillis = project.updatedAtMillis;
  }

  return {
    healthy: false,
    configFilePath,
  };
}

export function getRemoteDevelopmentEnvironmentDebugSnapshot(): RemoteDevelopmentEnvironmentDebugSnapshot {
  assertRemoteDevelopmentEnvironmentEnabled();
  const globals = getGlobals();
  const now = performance.now();
  const unixNow = Date.now();
  const state = readRemoteDevelopmentEnvironmentState();
  return {
    uptimeMs: Math.round(now - globals.startedAtMs),
    shutdownTimerStarted: globals.shutdownTimerStarted,
    activeOperations: globals.activeOperations,
    hasClosedSession: globals.hasClosedSession,
    sessions: [...globals.sessions.entries()].map(([sessionId, session]) => {
      const ttlMs = session.receivedFirstHeartbeat ? SESSION_TTL_MS : FIRST_HEARTBEAT_TTL_MS;
      const lastHeartbeatAgeMs = Math.round(now - session.lastHeartbeatMs);
      return {
        sessionId,
        configFilePath: session.configFilePath,
        lastHeartbeatAgeMs,
        ttlMs,
        expiresInMs: Math.max(0, ttlMs - lastHeartbeatAgeMs),
        receivedFirstHeartbeat: session.receivedFirstHeartbeat,
      };
    }),
    watchedConfigFiles: [...globals.watchers.keys()],
    pendingSyncConfigFiles: [...globals.syncTimers.keys()],
    syncErrors: [...globals.syncErrors.entries()].map(([configFilePath, error]) => ({
      configFilePath,
      error: errorToNiceString(error),
    })),
    synchronouslyUpdatingConfigFiles: [...globals.synchronouslyUpdatingConfigFiles],
    localDashboards: Object.values(state.localDashboardsByPort ?? {})
      .filter((dashboard) => dashboard != null)
      .map((dashboard) => ({
        port: dashboard.port,
        pid: dashboard.pid,
        startedAgoMs: Math.max(0, unixNow - dashboard.startedAtMillis),
        logPath: dashboard.logPath,
      })),
    pendingBrowserSecretConfirmationCodes: Object.entries(state.pendingBrowserSecretConfirmationCodesByPort ?? {})
      .flatMap(([port, code]) => code == null ? [] : [{
        port,
        code: code.code,
        expiresInMs: Math.max(0, code.expiresAtMillis - unixNow),
        updatedAgoMs: Math.max(0, unixNow - code.updatedAtMillis),
      }]),
    projects: Object.entries(state.projectsByConfigPath)
      .flatMap(([configFilePath, project]) => project == null ? [] : [{
        configFilePath,
        projectId: project.projectId,
        teamId: project.teamId,
        apiBaseUrl: project.apiBaseUrl,
        updatedAgoMs: Math.max(0, unixNow - project.updatedAtMillis),
        hasLastSyncedConfigHash: project.lastSyncedConfigHash != null,
      }]),
  };
}

export async function applyRemoteDevelopmentEnvironmentConfigUpdate(options: {
  sessionId?: string,
  projectId?: string,
  configUpdate: Config,
  waitForSync?: boolean,
}): Promise<void> {
  assertRemoteDevelopmentEnvironmentEnabled();
  const endOperation = beginRemoteDevelopmentEnvironmentOperation("config update", {
    sessionId: options.sessionId,
    projectId: options.projectId,
  });
  try {
    const state = getGlobals();
    const session = (() => {
      if (options.sessionId != null) {
        return state.sessions.get(options.sessionId);
      }
      if (options.projectId == null) {
        throw new Error("Remote development environment config update requires a session ID or project ID.");
      }
      for (const activeSession of state.sessions.values()) {
        const stateProject = readRemoteDevelopmentEnvironmentState().projectsByConfigPath[activeSession.configFilePath];
        if (stateProject?.projectId === options.projectId) {
          return activeSession;
        }
      }
      return undefined;
    })();
    if (session == null) {
      throw new Error("Remote development environment session is not active.");
    }
    const configFilePath = session.configFilePath;
    logRemoteDevelopmentEnvironment("Applying config update from local dashboard", {
      sessionId: options.sessionId,
      projectId: options.projectId,
      configFilePath,
    });
    const currentConfig = (await readConfigFile(configFilePath)).config;
    if (options.waitForSync === false) {
      writeConfigObject(configFilePath, override(currentConfig, options.configUpdate));
      scheduleSync(configFilePath);
    } else {
      state.synchronouslyUpdatingConfigFiles.add(configFilePath);
      try {
        writeConfigObject(configFilePath, override(currentConfig, options.configUpdate));
      } finally {
        setTimeout(() => {
          state.synchronouslyUpdatingConfigFiles.delete(configFilePath);
        }, SYNC_DEBOUNCE_MS).unref();
      }
      await syncConfigToRemoteNow(configFilePath);
    }
    logRemoteDevelopmentEnvironment("Applied config update from local dashboard", {
      sessionId: options.sessionId,
      projectId: options.projectId,
      configFilePath,
      waitForSync: options.waitForSync ?? true,
    });
  } finally {
    endOperation();
  }
}
