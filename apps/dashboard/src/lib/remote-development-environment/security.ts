import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createUrlIfValid, isLocalhost } from "@hexclave/shared/dist/utils/urls";
import { assertRemoteDevelopmentEnvironmentBrowserSecret } from "./browser-secret";
import { isRemoteDevelopmentEnvironmentEnabled } from "./env";
import { LocalDashboardState, RemoteDevelopmentEnvironmentState, readRemoteDevelopmentEnvironmentState } from "./state";

function requestHostIsLoopback(req: NextRequest): boolean {
  const host = req.headers.get("host");
  if (host == null) return false;
  return isLocalhost(`http://${host}`);
}

function loopbackRejectionMessage(req: NextRequest, state: RemoteDevelopmentEnvironmentState): string {
  const dashboards = localDashboards(state);
  const port = requestHostPort(req) ?? (dashboards.length > 0 ? dashboards[0].port : null);
  const suggestedUrl = port != null ? `http://127.0.0.1:${port}` : "http://127.0.0.1:<port>";
  return `You're accessing the development environment using an unsupported address (such as 'localhost'). Please go to ${suggestedUrl} instead — copy and paste this address into your browser.`;
}

function requestHostUrl(req: NextRequest): URL | null {
  const host = req.headers.get("host");
  if (host == null) return null;
  return createUrlIfValid(`http://${host}`);
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

export function assertRemoteDevelopmentEnvironmentRequest(req: NextRequest): NextResponse | null {
  if (!isRemoteDevelopmentEnvironmentEnabled()) {
    return NextResponse.json({ error: "Remote development environment endpoints are disabled." }, { status: 404 });
  }

  const state = readRemoteDevelopmentEnvironmentState();
  if (!requestHostIsLoopback(req)) {
    return NextResponse.json({ error: loopbackRejectionMessage(req, state) }, { status: 403 });
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
  return assertRemoteDevelopmentEnvironmentBrowserSecret(req);
}
