import { NextRequest, NextResponse } from "next/server";
import { isRemoteDevelopmentEnvironmentEnabled } from "@/lib/remote-development-environment/env";
import { isLocalhost } from "@stackframe/stack-shared/dist/utils/urls";

export const runtime = "nodejs";

const INTERNAL_PROJECT_ID = "internal";

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

function assertRemoteDevelopmentEnvironmentBrowserRequest(req: NextRequest): NextResponse | null {
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

function isInternalProjectRefreshCookieName(name: string): boolean {
  return (
    name === "stack-refresh" ||
    name === `stack-refresh-${INTERNAL_PROJECT_ID}` ||
    name.startsWith(`stack-refresh-${INTERNAL_PROJECT_ID}--`) ||
    name.startsWith(`__Host-stack-refresh-${INTERNAL_PROJECT_ID}--`)
  );
}

function deleteInternalProjectAuthCookies(req: NextRequest, response: NextResponse): void {
  response.cookies.delete("stack-access");
  for (const cookie of req.cookies.getAll()) {
    if (isInternalProjectRefreshCookieName(cookie.name)) {
      response.cookies.delete(cookie.name);
    }
  }
}

export async function GET(req: NextRequest) {
  const securityResponse = assertRemoteDevelopmentEnvironmentBrowserRequest(req);
  if (securityResponse != null) return securityResponse;

  const { getRemoteDevelopmentEnvironmentAccessToken } = await import("@/lib/remote-development-environment/manager");
  const token = await getRemoteDevelopmentEnvironmentAccessToken();
  const response = NextResponse.json({
    access_token: token.accessToken,
    expires_at_millis: token.expiresAtMillis,
    issued_at_millis: token.issuedAtMillis,
    user_id: token.userId,
  });
  deleteInternalProjectAuthCookies(req, response);
  return response;
}
