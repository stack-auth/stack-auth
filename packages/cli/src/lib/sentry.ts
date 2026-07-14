import { homedir } from "os";
import { cliVersion } from "./own-package.js";

declare const __STACK_CLI_SENTRY_DSN__: string;

function scrubString(input: string): string {
  let out = input;
  const home = homedir();
  if (home && home.length > 1) out = out.split(home).join("~");
  return out.replace(/\b(sk_[A-Za-z0-9_-]+|pk_[A-Za-z0-9_-]+|pck_[A-Za-z0-9_-]+|stk_[A-Za-z0-9_-]+|ssk_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, "[redacted]");
}
function isSensitiveKey(key: string): boolean {
  return /token|key|secret|password|dsn|authorization|cookie/i.test(key);
}
function scrubValue(value: unknown, key?: string): unknown {
  if (key && isSensitiveKey(key) && value != null) return "[redacted]";
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubValue(v, k);
    return out;
  }
  return value;
}

let registrationPromise: Promise<void> | undefined;
let sentryModule: typeof import("@sentry/node") | undefined;
let initPromise: Promise<void> | undefined;
let capturePromise: Promise<void> | undefined;

async function loadSentry(): Promise<typeof import("@sentry/node")> {
  sentryModule ??= await import("@sentry/node");
  return sentryModule;
}
async function initializeSentry(): Promise<void> {
  if (initPromise != null) return await initPromise;
  initPromise = (async () => {
    const [{ getEnvVariable, getNodeEnvironment }, { sentryBaseConfig }, { nicify }, Sentry] = await Promise.all([
      import("@hexclave/shared/dist/utils/env"),
      import("@hexclave/shared/dist/utils/sentry"),
      import("@hexclave/shared/dist/utils/strings"),
      loadSentry(),
    ]);
    const dsn = typeof __STACK_CLI_SENTRY_DSN__ === "string" ? __STACK_CLI_SENTRY_DSN__ : "";
    const version = cliVersion();
    Sentry.init({
      ...sentryBaseConfig, dsn, enabled: !!dsn && getNodeEnvironment() !== "development" && !getEnvVariable("CI", ""),
      release: version ? `stack-cli@${version}` : undefined, environment: "production", sendDefaultPii: false, tracesSampleRate: 0, includeLocalVariables: false,
      beforeSend(event, hint) {
        const error = hint.originalException;
        let nicified;
        try {
          nicified = nicify(error, { maxDepth: 8 });
        } catch (e) {
          nicified = `Error occurred during nicification: ${e}`;
        }
        if (error instanceof Error) event.extra = { ...event.extra, cause: error.cause, errorProps: { ...error }, nicifiedError: nicified };
        return scrubValue(event) as typeof event;
      },
    });
  })();
  await initPromise;
}

export function initSentry(): void {
  registrationPromise ??= import("@hexclave/shared/dist/utils/errors").then(({ registerErrorSink }) => registerErrorSink((location, error, level) => {
    capturePromise = (async () => {
      await initializeSentry();
      const Sentry = await loadSentry();
      Sentry.captureException(error, { extra: { location }, level });
      await Sentry.flush(2000);
    })();
  }));
}

export async function flushSentry(timeoutMs = 2000): Promise<void> {
  await registrationPromise;
  await capturePromise;
  if (sentryModule != null) await sentryModule.flush(timeoutMs);
}
