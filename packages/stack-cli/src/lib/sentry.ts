import * as Sentry from "@sentry/node";
import { getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { registerErrorSink } from "@stackframe/stack-shared/dist/utils/errors";
import { ignoreUnhandledRejection } from "@stackframe/stack-shared/dist/utils/promises";
import { sentryBaseConfig } from "@stackframe/stack-shared/dist/utils/sentry";
import { nicify } from "@stackframe/stack-shared/dist/utils/strings";
import { readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Replaced at build time by tsdown `define`. Empty = not configured (dev/unbuilt).
declare const __STACK_CLI_SENTRY_DSN__: string;

function readPackageVersion(): string | undefined {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf-8")) as { version?: string };
    return pkg.version;
  } catch {
    return undefined;
  }
}

function scrubString(input: string): string {
  let out = input;
  const home = homedir();
  if (home && home.length > 1) {
    out = out.split(home).join("~");
  }
  out = out.replace(/\b(sk_[A-Za-z0-9_-]+|pk_[A-Za-z0-9_-]+|pck_[A-Za-z0-9_-]+|stk_[A-Za-z0-9_-]+|ssk_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, "[redacted]");
  return out;
}

function isSensitiveKey(key: string): boolean {
  return /token|key|secret|password|dsn|authorization|cookie/i.test(key);
}

function scrubValue(value: unknown, key?: string): unknown {
  if (key && isSensitiveKey(key) && value != null) {
    return "[redacted]";
  }
  if (typeof value === "string") {
    return scrubString(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrubValue(v));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = scrubValue(v, k);
    }
    return out;
  }
  return value;
}

export function initSentry() {
  const dsn = typeof __STACK_CLI_SENTRY_DSN__ === "string" ? __STACK_CLI_SENTRY_DSN__ : "";
  const version = readPackageVersion();

  Sentry.init({
    ...sentryBaseConfig,
    dsn,
    enabled: !!dsn && getNodeEnvironment() !== "development" && !getEnvVariable("CI", ""),
    release: version ? `stack-cli@${version}` : undefined,
    environment: "production",
    sendDefaultPii: false,
    tracesSampleRate: 0,
    includeLocalVariables: false,
    beforeSend(event, hint) {
      const error = hint.originalException;
      let nicified;
      try {
        nicified = nicify(error, { maxDepth: 8 });
      } catch (e) {
        nicified = `Error occurred during nicification: ${e}`;
      }
      if (error instanceof Error) {
        event.extra = {
          ...event.extra,
          cause: error.cause,
          errorProps: { ...error },
          nicifiedError: nicified,
        };
      }
      return scrubValue(event) as typeof event;
    },
  });

  registerErrorSink((location, error) => {
    Sentry.captureException(error, { extra: { location } });
    ignoreUnhandledRejection(Sentry.flush(2000));
  });
}
