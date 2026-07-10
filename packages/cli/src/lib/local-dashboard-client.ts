import { DEFAULT_PUBLISHABLE_CLIENT_KEY, type ProjectAuthWithRefreshToken } from "./auth.js";
import { resolveConfigFilePathOption } from "./config-file-path.js";
import { readDevEnvState } from "./dev-env-state.js";
import { CliError } from "./errors.js";
import { closeRemoteDevelopmentEnvironmentSession, createRemoteDevelopmentEnvironmentSession, dashboardPort, dashboardUrl } from "./local-dashboard.js";

type DashboardProjectState = {
  projectId: string,
  apiBaseUrl: string,
};

function dashboardSecretForPort(port: number): string {
  const secret = readDevEnvState().localDashboardsByPort?.[String(port)]?.secret;
  if (secret == null || secret.length === 0) {
    throw new CliError(`No local dashboard session found on port ${port}. Start your development environment with \`hexclave dev --config-file <path> -- <command>\` and try again.`);
  }
  return secret;
}

async function registerDashboardSession(configFilePath: string, port: number, secret: string): Promise<void> {
  const session = await createRemoteDevelopmentEnvironmentSession({
    apiBaseUrl: readDevEnvState().anonymousApiBaseUrl,
    configFilePath,
    port,
    secret,
  });
  await closeRemoteDevelopmentEnvironmentSession(session.session_id, secret, port);
}

function findDashboardProject(configFilePath: string): DashboardProjectState | null {
  const project = readDevEnvState().projectsByConfigPath[configFilePath];
  if (project == null) return null;
  return {
    projectId: project.projectId,
    apiBaseUrl: project.apiBaseUrl,
  };
}

export async function resolveLocalDashboardAuthByConfigPath(configFile: string): Promise<ProjectAuthWithRefreshToken> {
  const configFilePath = resolveConfigFilePathOption(configFile, { mustExist: true });
  let project = findDashboardProject(configFilePath);
  if (project == null) {
    const port = dashboardPort();
    const secret = dashboardSecretForPort(port);
    await registerDashboardSession(configFilePath, port, secret);
    project = findDashboardProject(configFilePath);
  }

  const state = readDevEnvState();
  if (project == null) {
    throw new CliError(`Local dashboard did not register a development-environment project for ${configFilePath}.`);
  }
  if (state.anonymousRefreshToken == null || state.anonymousRefreshToken.length === 0) {
    throw new CliError("Local dashboard has no development-environment user session yet. Run `hexclave dev --config-file <path> -- <command>` first.");
  }

  return {
    apiUrl: project.apiBaseUrl,
    dashboardUrl: dashboardUrl(),
    publishableClientKey: DEFAULT_PUBLISHABLE_CLIENT_KEY,
    refreshToken: state.anonymousRefreshToken,
    projectId: project.projectId,
  };
}
