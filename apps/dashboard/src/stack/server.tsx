import "server-only";

import { isRemoteDevelopmentEnvironmentEnabled } from "@/lib/remote-development-environment/env";
import { StackServerApp } from "@stackframe/stack";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { stackClientApp } from "./client";

type InternalServerApp = StackServerApp<true, "internal">;
let _stackServerApp: InternalServerApp | undefined;

export function getStackServerApp(): InternalServerApp {
  if (!_stackServerApp) {
    if (isRemoteDevelopmentEnvironmentEnabled()) {
      throw new StackAssertionError("stackServerApp is not available in the local remote development environment dashboard.");
    }
    _stackServerApp = new StackServerApp({
      inheritsFrom: stackClientApp,
    });
  }
  return _stackServerApp;
}
