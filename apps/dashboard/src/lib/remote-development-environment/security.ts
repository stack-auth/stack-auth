import "server-only";

import { getPublicEnvVar } from "@/lib/env";
import { NextRequest, NextResponse } from "next/server";
import { createUrlIfValid, isLocalhost } from "@hexclave/shared/dist/utils/urls";
import { isRemoteDevelopmentEnvironmentEnabled } from "./env";
import { LocalDashboardState, RemoteDevelopmentEnvironmentState, readRemoteDevelopmentEnvironmentState } from "./state";

function urlOrigin(value: string | undefined): string | null {
  if (value == null || value.length === 0) return null;
  return createUrlIfValid(value)?.origin ?? null;
}

function requestHostIsLoopback(req: NextRequest): boolean {
  const host = req.headers.get("host");
  if (host == null) return false;
  return isLocalhost(`http://${host}`);
}

function requestHostUrl(req: NextRequest): URL | null {
  const host = req.headers.get("host");
  if (host == null) return null;
  return createUrlIfValid(`http://${host}`);
}

function requestHostOrigin(req: NextRequest): string | null {
  return requestHostUrl(req)?.origin ?? null;
}

function requestHostPort(req: NextRequest): number | null {
  const port = requestHostUrl(req)?.port;
  return port == null || port.length === 0 ? null : Number(port);
}

function localDashboards(state: RemoteDevelopmentEnvironmentState): LocalDashboardState[] {
  return Object.values(state.localDashboardsByPort ?? {})
    .filter((dashboard): dashboard is LocalDashboardState => dashboard != null);
}

function localDashboardSecretForRequest(req: NextRequest, state: RemoteDevelopmentEnvironmentState): string | null {
  const port = requestHostPort(req);
  if (port == null) return null;
  return localDashboards(state).find((dashboard) => dashboard.port === port)?.secret ?? null;
}

function hasActiveLocalDashboard(state: RemoteDevelopmentEnvironmentState): boolean {
  return localDashboards(state).some((dashboard) => dashboard.secret.length > 0);
}

function expectedDashboardOrigins(state: RemoteDevelopmentEnvironmentState): Set<string> {
  return new Set([
    urlOrigin(getPublicEnvVar("NEXT_PUBLIC_STACK_DASHBOARD_URL")),
    urlOrigin(getPublicEnvVar("NEXT_PUBLIC_BROWSER_STACK_DASHBOARD_URL")),
    urlOrigin(getPublicEnvVar("NEXT_PUBLIC_SERVER_STACK_DASHBOARD_URL")),
    ...localDashboards(state).map((dashboard) => `http://127.0.0.1:${dashboard.port}`),
  ].filter((origin): origin is string => origin != null));
}

function browserRequestOriginIsAllowed(req: NextRequest, state: RemoteDevelopmentEnvironmentState): boolean {
  const allowedOrigins = expectedDashboardOrigins(state);
  const requestOrigin = requestHostOrigin(req);
  if (requestOrigin == null || !allowedOrigins.has(requestOrigin)) return false;

  const origin = req.headers.get("origin");
  if (origin == null) return true;
  const parsedOrigin = urlOrigin(origin);
  return parsedOrigin != null && allowedOrigins.has(parsedOrigin);
}

export function assertRemoteDevelopmentEnvironmentRequest(req: NextRequest): NextResponse | null {
  if (!isRemoteDevelopmentEnvironmentEnabled()) {
    return NextResponse.json({ error: "Remote development environment endpoints are disabled." }, { status: 404 });
  }

  const state = readRemoteDevelopmentEnvironmentState();
  if (!requestHostIsLoopback(req)) {
    return NextResponse.json({ error: "Remote development environment endpoints only accept loopback requests." }, { status: 403 });
  }

  const expectedSecret = localDashboardSecretForRequest(req, state);
  if (expectedSecret == null || expectedSecret.length === 0) {
    return NextResponse.json({ error: "Remote development environment is not active." }, { status: 404 });
  }

  const authorization = req.headers.get("authorization");
  if (authorization !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return null;
}

export function assertRemoteDevelopmentEnvironmentBrowserRequest(req: NextRequest): NextResponse | null {
  if (!isRemoteDevelopmentEnvironmentEnabled()) {
    return NextResponse.json({ error: "Remote development environment endpoints are disabled." }, { status: 404 });
  }

  const state = readRemoteDevelopmentEnvironmentState();
  if (!hasActiveLocalDashboard(state)) {
    return NextResponse.json({ error: "Remote development environment is not active." }, { status: 404 });
  }

  if (!requestHostIsLoopback(req) || !browserRequestOriginIsAllowed(req, state)) {
    return NextResponse.json({ error: "Remote development environment endpoints only accept loopback requests." }, { status: 403 });
  }

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite != null && fetchSite !== "same-origin" && fetchSite !== "none") {
    return NextResponse.json({ error: "Remote development environment browser auth only accepts same-origin navigation." }, { status: 403 });
  }

  return null;
}
