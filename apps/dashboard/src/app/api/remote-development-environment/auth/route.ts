import { NextRequest, NextResponse } from "next/server";
import { assertRemoteDevelopmentEnvironmentBrowserRequest } from "@/lib/remote-development-environment/security";

export const runtime = "nodejs";

const INTERNAL_PROJECT_ID = "internal";

function isInternalProjectRefreshCookieName(name: string): boolean {
  // Hexclave rebrand: match refresh cookies under both the `stack-refresh-*` and `hexclave-refresh-*` bases.
  return (
    name === "stack-refresh" ||
    name === `stack-refresh-${INTERNAL_PROJECT_ID}` ||
    name.startsWith(`stack-refresh-${INTERNAL_PROJECT_ID}--`) ||
    name.startsWith(`__Host-stack-refresh-${INTERNAL_PROJECT_ID}--`) ||
    name === `hexclave-refresh-${INTERNAL_PROJECT_ID}` ||
    name.startsWith(`hexclave-refresh-${INTERNAL_PROJECT_ID}--`) ||
    name.startsWith(`__Host-hexclave-refresh-${INTERNAL_PROJECT_ID}--`)
  );
}

function deleteInternalProjectAuthCookies(req: NextRequest, response: NextResponse): void {
  // Hexclave rebrand: delete the access cookie under both names.
  response.cookies.delete("hexclave-access");
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
  response.headers.set("Cache-Control", "no-store, no-cache");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  deleteInternalProjectAuthCookies(req, response);
  return response;
}
