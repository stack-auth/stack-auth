import { fetchWithRemoteDevelopmentEnvironmentBrowserSecret, RemoteDevelopmentEnvironmentBrowserSecretRedirectingError } from "@/app/remote-development-environment-browser-secret-client";
import type { StackAdminApp } from "@hexclave/next";
import type { EnvironmentConfigOverrideOverride } from "@hexclave/shared/dist/config/schema";

export async function updateRemoteDevelopmentEnvironmentConfigFile(
  adminApp: StackAdminApp<false>,
  configUpdate: EnvironmentConfigOverrideOverride,
): Promise<"updated" | "redirecting"> {
  try {
    const response = await fetchWithRemoteDevelopmentEnvironmentBrowserSecret("/api/remote-development-environment/config/apply-update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        project_id: adminApp.projectId,
        config_update: configUpdate,
        wait_for_sync: true,
      }),
      signal: AbortSignal.timeout(130_000),
    });
    if (!response.ok) {
      throw new Error(`Failed to update local development environment config (${response.status}): ${await response.text()}`);
    }
    return "updated";
  } catch (error) {
    if (error instanceof RemoteDevelopmentEnvironmentBrowserSecretRedirectingError) {
      return "redirecting";
    }
    throw error;
  }
}
