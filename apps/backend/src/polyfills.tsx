import * as Sentry from "@sentry/nextjs";
import { getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, registerErrorSink } from "@stackframe/stack-shared/dist/utils/errors";
import * as util from "util";

export function expandStackPortPrefix(value?: string | null) {
  if (!value) return value ?? undefined;
  const prefix = getEnvVariable("NEXT_PUBLIC_STACK_PORT_PREFIX", "81");
  return prefix ? value.replace(/\$\{NEXT_PUBLIC_STACK_PORT_PREFIX:-81\}/g, prefix) : value;
}

const sentryErrorSink = (location: string, error: unknown) => {
  Sentry.captureException(error, { extra: { location } });
};

export function ensurePolyfilled() {
  if (!getEnvVariable("STACK_PORT_PREFIX_EXPANDED", "")) {
    // eslint-disable-next-line no-restricted-syntax
    process.env.STACK_PORT_PREFIX_EXPANDED = "true";
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith("STACK_") || key.startsWith("NEXT_PUBLIC_STACK_")) {
        const replaced = expandStackPortPrefix(value ?? undefined);
        if (replaced !== undefined) {
          // eslint-disable-next-line no-restricted-syntax
          process.env[key] = replaced;
        }
      }
    }
  }

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
        console.error("\x1b[41mUnhandled promise rejection. Some production environments (particularly Vercel) will kill the server in this case, so the server will now exit. Please use the `ignoreUnhandledRejection` function to signal that you've handled the error.\x1b[0m", reason);
      }
      process.exit(1);
    });
  }
}

ensurePolyfilled();
