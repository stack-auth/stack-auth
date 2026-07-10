import { getPublicEnvVar } from "@/lib/env";
import { assertRemoteDevelopmentEnvironmentBrowserRequest } from "@/lib/remote-development-environment/security";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const isRemoteDevelopmentEnvironment = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT") === "true";
  if (!isRemoteDevelopmentEnvironment) {
    return NextResponse.json({ error: "This endpoint is only available in remote development environments." }, { status: 404 });
  }

  const securityResponse = assertRemoteDevelopmentEnvironmentBrowserRequest(req);
  if (securityResponse != null) return securityResponse;

  const { getRemoteDevelopmentEnvironmentProjectConfigPaths } = await import("@/lib/remote-development-environment/manager");
  const configPaths = getRemoteDevelopmentEnvironmentProjectConfigPaths();
  const projectConfigPaths: Record<string, string> = {};
  for (const [projectId, configFilePath] of configPaths) {
    projectConfigPaths[projectId] = configFilePath;
  }
  return NextResponse.json({ project_config_paths: projectConfigPaths });
}
