import "server-only";

import { getEnvVariable } from "@hexclave/shared/dist/utils/env";

export async function startRemoteDevelopmentEnvironmentLifecycleIfNeeded(): Promise<void> {
  if (getEnvVariable("NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT", "") !== "true") {
    return;
  }

  const { startRemoteDevelopmentEnvironmentLifecycle } = await import("./lib/remote-development-environment/manager");
  startRemoteDevelopmentEnvironmentLifecycle();
}
