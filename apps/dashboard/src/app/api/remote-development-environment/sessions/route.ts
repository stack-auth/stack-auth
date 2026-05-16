import { NextRequest, NextResponse } from "next/server";
import { registerRemoteDevelopmentEnvironmentSession } from "@/lib/remote-development-environment/manager";
import { assertRemoteDevelopmentEnvironmentRequest } from "@/lib/remote-development-environment/security";
import { createUrlIfValid, isLocalhost } from "@stackframe/stack-shared/dist/utils/urls";

export const runtime = "nodejs";

async function readJsonBody(req: NextRequest): Promise<unknown | NextResponse> {
  try {
    return await req.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Malformed JSON request body." }, { status: 400 });
    }
    throw error;
  }
}

function isAllowedApiBaseUrl(value: string): boolean {
  const url = createUrlIfValid(value);
  if (url == null || (url.protocol !== "http:" && url.protocol !== "https:")) return false;
  return isLocalhost(url) || url.hostname === "api.stack-auth.com" || url.hostname.endsWith(".stack-auth.com");
}

export async function POST(req: NextRequest) {
  const securityResponse = assertRemoteDevelopmentEnvironmentRequest(req);
  if (securityResponse != null) return securityResponse;

  const parsedBody = await readJsonBody(req);
  if (parsedBody instanceof NextResponse) return parsedBody;

  const body = parsedBody as {
    api_base_url?: unknown,
    config_path?: unknown,
  };
  if (typeof body.api_base_url !== "string" || typeof body.config_path !== "string") {
    return NextResponse.json({ error: "api_base_url and config_path are required." }, { status: 400 });
  }
  if (!isAllowedApiBaseUrl(body.api_base_url)) {
    return NextResponse.json({ error: "api_base_url is not allowed for remote development environments." }, { status: 400 });
  }

  const result = await registerRemoteDevelopmentEnvironmentSession({
    apiBaseUrl: body.api_base_url,
    configPath: body.config_path,
  });
  return NextResponse.json({
    session_id: result.sessionId,
    env: result.env,
    project_id: result.projectId,
    onboarding_outstanding: result.onboardingOutstanding,
  });
}
