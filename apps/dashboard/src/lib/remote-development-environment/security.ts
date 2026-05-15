import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { isLocalhost } from "@stackframe/stack-shared/dist/utils/urls";
import { isRemoteDevelopmentEnvironmentEnabled } from "./env";
import { readRemoteDevelopmentEnvironmentState } from "./state";

function requestHostIsLoopback(req: NextRequest): boolean {
  const host = req.headers.get("host");
  if (host == null) return false;
  return isLocalhost(`http://${host}`);
}

function originIsAllowed(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (origin == null) return true;
  return isLocalhost(origin);
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

  if (!requestHostIsLoopback(req) || !originIsAllowed(req)) {
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

  if (!requestHostIsLoopback(req) || !originIsAllowed(req)) {
    return NextResponse.json({ error: "Remote development environment endpoints only accept loopback requests." }, { status: 403 });
  }

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite != null && fetchSite !== "same-origin" && fetchSite !== "none") {
    return NextResponse.json({ error: "Remote development environment browser auth only accepts same-origin navigation." }, { status: 403 });
  }

  return null;
}
