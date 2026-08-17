import { getPublicEnvVar } from "@/lib/env";

type TvDisplayUrlSources = {
  browserDashboardUrl?: string,
  dashboardUrl?: string,
  currentOrigin?: string,
};

export function buildTvDisplayUrl(sources: TvDisplayUrlSources): string | null {
  const publicOrigin = sources.browserDashboardUrl
    ?? sources.dashboardUrl
    ?? sources.currentOrigin;
  if (publicOrigin == null) return null;
  return new URL("/tv", publicOrigin).toString();
}

export function getConfiguredTvDisplayUrl(currentOrigin?: string): string | null {
  return buildTvDisplayUrl({
    browserDashboardUrl: getPublicEnvVar("NEXT_PUBLIC_BROWSER_STACK_DASHBOARD_URL"),
    dashboardUrl: getPublicEnvVar("NEXT_PUBLIC_STACK_DASHBOARD_URL"),
    currentOrigin,
  });
}

export function isLocalTvDisplayUrl(url: string): boolean {
  const hostname = new URL(url).hostname;
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "[::1]"
    || hostname.endsWith(".localhost");
}
