import "server-only";

import { getEnvBoolean } from "@hexclave/shared/dist/utils/env";

export async function startRemoteDevelopmentEnvironmentLifecycleIfNeeded(): Promise<void> {
  if (!getEnvBoolean("NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT")) {
    return;
  }

  const { startRemoteDevelopmentEnvironmentLifecycle } = await import("./lib/remote-development-environment/manager");
  startRemoteDevelopmentEnvironmentLifecycle();
}
