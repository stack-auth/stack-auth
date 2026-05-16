import { NextRequest, NextResponse } from "next/server";
import { isAllowedRemoteDevelopmentEnvironmentApiBaseUrl } from "@/lib/remote-development-environment/api-base-url";
import { registerRemoteDevelopmentEnvironmentSession } from "@/lib/remote-development-environment/manager";
import { readRemoteDevelopmentEnvironmentJsonBody } from "@/lib/remote-development-environment/route-json";
import { assertRemoteDevelopmentEnvironmentRequest } from "@/lib/remote-development-environment/security";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const securityResponse = assertRemoteDevelopmentEnvironmentRequest(req);
  if (securityResponse != null) return securityResponse;

  const parsedBody = await readRemoteDevelopmentEnvironmentJsonBody(req);
  if (parsedBody instanceof NextResponse) return parsedBody;

  const body = parsedBody as {
    api_base_url?: unknown,
    config_path?: unknown,
  };
  if (typeof body.api_base_url !== "string" || typeof body.config_path !== "string") {
    return NextResponse.json({ error: "api_base_url and config_path are required." }, { status: 400 });
  }
  if (!isAllowedRemoteDevelopmentEnvironmentApiBaseUrl(body.api_base_url)) {
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
