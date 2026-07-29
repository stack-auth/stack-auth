import "server-only";

import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";

export const REMOTE_DEVELOPMENT_ENVIRONMENT_ENABLED_ENV = "NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT";

export function isRemoteDevelopmentEnvironmentEnabled(): boolean {
  return getEnvVariable(REMOTE_DEVELOPMENT_ENVIRONMENT_ENABLED_ENV, "false") === "true";
}

export function assertRemoteDevelopmentEnvironmentEnabled(): void {
  if (!isRemoteDevelopmentEnvironmentEnabled()) {
    throw new HexclaveAssertionError(`${REMOTE_DEVELOPMENT_ENVIRONMENT_ENABLED_ENV}=true is required to use remote development environment internals.`);
  }
}
