import * as Sentry from "@sentry/nextjs";
import { getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, registerErrorSink } from "@stackframe/stack-shared/dist/utils/errors";
import * as util from "util";
import { getPublicEnvVar } from "./lib/env";

function expandStackPortPrefix(value?: string | null) {
  if (!value) return value ?? undefined;
  const prefix = getPublicEnvVar("NEXT_PUBLIC_STACK_PORT_PREFIX") ?? "81";
  return prefix ? value.replace(/\$\{NEXT_PUBLIC_STACK_PORT_PREFIX:-81\}/g, prefix as string) : value;
}

const sentryErrorSink = (location: string, error: unknown) => {
  Sentry.captureException(error, { extra: { location } });
};

export function ensurePolyfilled() {
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("STACK_") || key.startsWith("NEXT_PUBLIC_STACK_")) {
      const replaced = expandStackPortPrefix(value ?? undefined);
      if (replaced !== undefined) {
        process.env[key] = replaced;
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
        console.error("Unhandled promise rejection. Some production environments (particularly Vercel) will kill the server in this case, so the server will now exit. Please use the `ignoreUnhandledRejection` function to signal that you've handled the error.", reason);
      }
      if ((globalThis.process as any).exit) {
        globalThis.process.exit(1);
      }
    });
  }
}

ensurePolyfilled();
