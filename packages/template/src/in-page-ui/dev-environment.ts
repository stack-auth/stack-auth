// Shared "are we in a development-like environment?" check for Hexclave's in-page UIs. Some of them (eg. surfacing an
// unexpected internal error) are only appropriate while developing, and the SDK cannot ask the server about it because
// the check has to work synchronously and before the app is authenticated.

import { isLocalhost } from "@hexclave/shared/dist/utils/urls";
import { envVars } from "../generated/env";

export function isLikelyDevelopmentEnvironment(): boolean {
  // NODE_ENV is the most reliable signal, but plenty of bundlers (eg. Vite-based ones) don't define it in the browser
  // bundle at all, so fall back to guessing from the current URL.
  const nodeEnv = envVars.NODE_ENV;
  if (nodeEnv !== undefined) {
    return nodeEnv === "development";
  }

  if (typeof window === "undefined") {
    return false;
  }

  try {
    const url = new URL(window.location.href);
    if (url.protocol === "file:") {
      return true;
    }
  } catch {
    return false;
  }
  return isLocalhost(window.location.href);
}
