import "server-only";

import { StackServerApp } from "@hexclave/next";
import { hexclaveClientApp } from "./hexclave";

let hexclaveServerApp: StackServerApp<true, string> | undefined;

export function getHexclaveServerApp(): StackServerApp<true, string> {
  if (hexclaveServerApp == null) {
    hexclaveServerApp = new StackServerApp({
      inheritsFrom: hexclaveClientApp,
    });
  }
  return hexclaveServerApp;
}
