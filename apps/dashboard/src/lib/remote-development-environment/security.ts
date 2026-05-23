import "server-only";

import { getPublicEnvVar } from "@/lib/env";
import { NextRequest, NextResponse } from "next/server";
import { createUrlIfValid, isLocalhost } from "@stackframe/stack-shared/dist/utils/urls";
import { isRemoteDevelopmentEnvironmentEnabled } from "./env";
import { RemoteDevelopmentEnvironmentState, readRemoteDevelopmentEnvironmentState } from "./state";

function urlOrigin(value: string | undefined): string | null {
  if (value == null || value.length === 0) return null;
  return createUrlIfValid(value)?.origin ?? null;
}

function requestHostIsLoopback(req: NextRequest): boolean {
  const host = req.headers.get("host");
  if (host == null) return false;
  return isLocalhost(`http://${host}`);
}

function requestHostOrigin(req: NextRequest): string | null {
  const host = req.headers.get("host");
  if (host == null) return null;
  return urlOrigin(`http://${host}`);
}

function expectedDashboardOrigins(state: RemoteDevelopmentEnvironmentState): Set<string> {
  return new Set([
    urlOrigin(getPublicEnvVar("NEXT_PUBLIC_STACK_DASHBOARD_URL")),
    urlOrigin(getPublicEnvVar("NEXT_PUBLIC_BROWSER_STACK_DASHBOARD_URL")),
    urlOrigin(getPublicEnvVar("NEXT_PUBLIC_SERVER_STACK_DASHBOARD_URL")),
    state.localDashboard?.port == null ? null : `http://127.0.0.1:${state.localDashboard.port}`,
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
  const expectedSecret = state.localDashboard?.secret;
  if (expectedSecret == null || expectedSecret.length === 0) {
    return NextResponse.json({ error: "Remote development environment is not active." }, { status: 404 });
  }

  if (!requestHostIsLoopback(req)) {
    return NextResponse.json({ error: "Remote development environment endpoints only accept loopback requests." }, { status: 403 });
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
  const expectedSecret = state.localDashboard?.secret;
  if (expectedSecret == null || expectedSecret.length === 0) {
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
