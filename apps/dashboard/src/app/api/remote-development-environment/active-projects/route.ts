import { NextRequest, NextResponse } from "next/server";
import { getActiveRemoteDevelopmentEnvironmentProjectIds } from "@/lib/remote-development-environment/manager";
import { assertRemoteDevelopmentEnvironmentBrowserRequest } from "@/lib/remote-development-environment/security";

export const runtime = "nodejs";

export function GET(req: NextRequest) {
  const securityResponse = assertRemoteDevelopmentEnvironmentBrowserRequest(req);
  if (securityResponse != null) return securityResponse;

  const activeProjectIds = getActiveRemoteDevelopmentEnvironmentProjectIds();
  return NextResponse.json({ project_ids: [...activeProjectIds] });
}
