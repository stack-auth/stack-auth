import "server-only";

import { isRemoteDevelopmentEnvironmentEnabled } from "@/lib/remote-development-environment/env";
import { StackServerApp } from "@stackframe/stack";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { stackClientApp } from "./client";

if (isRemoteDevelopmentEnvironmentEnabled()) {
  throw new StackAssertionError("stackServerApp is not available in the local remote development environment dashboard.");
}

export const stackServerApp = new StackServerApp({
  inheritsFrom: stackClientApp,
});
