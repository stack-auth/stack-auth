import * as Sentry from "@sentry/nextjs";
import { getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, registerErrorSink } from "@stackframe/stack-shared/dist/utils/errors";
import * as util from "util";

const sentryErrorSink = (location: string, error: unknown) => {
  Sentry.captureException(error, { extra: { location } });
};

export function ensurePolyfilled() {
  registerErrorSink(sentryErrorSink);

  if ("addEventListener" in globalThis) {
    globalThis.addEventListener("unhandledrejection", (event) => {
      captureError("unhandled-browser-promise-rejection", event.reason);
      console.error("Unhandled promise rejection", event.reason);
    });
  }

  // not all environments have default options for util.inspect
  if ("inspect" in util && "defaultOptions" in util.inspect) {
    util.inspect.defaultOptions.depth = 8;
  }

  if (typeof process !== "undefined" && typeof process.on === "function") {
    process.on("unhandledRejection", (reason, promise) => {
      captureError("unhandled-promise-rejection", reason);
      if (getNodeEnvironment() === "development") {
        console.error("Unhandled promise rejection. Some production environments (particularly Vercel) will kill the server in this case, so the server will now exit. Please use the `ignoreUnhandledRejection` function to signal that you've handled the error.", reason);
      }
      if ((globalThis.process as any).exit) {
        globalThis.process.exit(1);
      }
    });
  }
}

ensurePolyfilled();
