import "server-only";

import { isRemoteDevelopmentEnvironmentEnabled } from "@/lib/remote-development-environment/env";
import { StackServerApp } from "@hexclave/next";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { hexclaveClientApp } from "./client";

type InternalServerApp = StackServerApp<true, "internal">;
let _stackServerApp: InternalServerApp | undefined;

export function getHexclaveServerApp(): InternalServerApp {
  if (!_stackServerApp) {
    if (isRemoteDevelopmentEnvironmentEnabled()) {
      throw new HexclaveAssertionError("hexclaveServerApp is not available in the local remote development environment dashboard.");
    }
    _stackServerApp = new StackServerApp({
      inheritsFrom: hexclaveClientApp,
    });
  }
  return _stackServerApp;
}
