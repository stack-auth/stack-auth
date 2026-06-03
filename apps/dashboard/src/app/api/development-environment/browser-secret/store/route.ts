import { readRemoteDevelopmentEnvironmentJsonBody } from "@/lib/remote-development-environment/route-json";
import { assertRemoteDevelopmentEnvironmentBrowserSecretSetupRequest, storeRemoteDevelopmentEnvironmentBrowserSecret } from "@/lib/remote-development-environment/browser-secret";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function browserSecretFromBody(value: unknown): string | null {
  if (
    value == null ||
    typeof value !== "object" ||
    !("browser_secret" in value) ||
    typeof value.browser_secret !== "string"
  ) {
    return null;
  }
  return value.browser_secret;
}

export async function POST(req: NextRequest) {
  const securityResponse = assertRemoteDevelopmentEnvironmentBrowserSecretSetupRequest(req);
  if (securityResponse != null) return securityResponse;

  const parsedBody = await readRemoteDevelopmentEnvironmentJsonBody(req);
  if (parsedBody instanceof NextResponse) return parsedBody;
  const browserSecret = browserSecretFromBody(parsedBody);
  if (browserSecret == null) {
    return NextResponse.json({ error: "browser_secret is required." }, { status: 400 });
  }

  return storeRemoteDevelopmentEnvironmentBrowserSecret(req, browserSecret);
}
