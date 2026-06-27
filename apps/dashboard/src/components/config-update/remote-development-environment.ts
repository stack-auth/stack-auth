import { fetchWithRemoteDevelopmentEnvironmentBrowserSecret, RemoteDevelopmentEnvironmentBrowserSecretRedirectingError } from "@/app/remote-development-environment-browser-secret-client";
import type { StackAdminApp } from "@hexclave/next";
import type { EnvironmentConfigOverrideOverride } from "@hexclave/shared/dist/config/schema";

export async function updateRemoteDevelopmentEnvironmentConfigFile(
  adminApp: StackAdminApp<false>,
  configUpdate: EnvironmentConfigOverrideOverride,
  options?: { signal?: AbortSignal },
): Promise<"updated" | "redirecting"> {
  // Combine the hard timeout with the caller's cancel signal (the apply dialog's
  // Cancel button) so either can abort the in-flight sync.
  const signals = [AbortSignal.timeout(130_000), options?.signal].filter((s): s is AbortSignal => s != null);
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
      signal: AbortSignal.any(signals),
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
