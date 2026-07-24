const SAME_ORIGIN_API_TRACE_TARGET = /^\/api(?:\/|$)/;
const DEVELOPMENT_NOOP_SENTRY_DSN = "https://development@localhost/1";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds exact-origin matchers for services that are allowed to receive trace
 * context. A loose substring match could leak tracing headers to an origin such
 * as `api.example.com.attacker.test`, so callers should use these matchers
 * instead of passing raw URL strings to Sentry or OpenTelemetry.
 */
export function createStackApiOriginTraceTargets(apiUrls: readonly (string | null | undefined)[]): RegExp[] {
  const targetsByOrigin = new Map<string, RegExp>();

  for (const apiUrl of apiUrls) {
    if (apiUrl == null || apiUrl === "") continue;

    const origin = new URL(apiUrl).origin;
    targetsByOrigin.set(origin, new RegExp(`^${escapeRegExp(origin)}(?:/|$)`));
  }

  return [...targetsByOrigin.values()];
}

export function createDashboardTracePropagationTargets(apiUrls: readonly (string | null | undefined)[]): RegExp[] {
  return [
    SAME_ORIGIN_API_TRACE_TARGET,
    ...createStackApiOriginTraceTargets(apiUrls),
  ];
}

/**
 * Local tracing stays enabled so the browser can propagate W3C context. The
 * development Sentry transport is a no-op, so enabling the client does not
 * send local telemetry outside the browser.
 */
export function shouldEnableDashboardTracePropagation(ci: string | undefined): boolean {
  return ci === undefined || ci === "";
}

export function resolveDashboardSentryDsn(configuredDsn: string | undefined, isDevelopment: boolean): string | undefined {
  if (configuredDsn !== undefined && configuredDsn !== "") return configuredDsn;
  return isDevelopment ? DEVELOPMENT_NOOP_SENTRY_DSN : undefined;
}
