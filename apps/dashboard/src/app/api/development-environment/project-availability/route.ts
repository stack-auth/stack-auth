import { getPublicEnvVar } from "@/lib/env";
import { isLocalhost } from "@hexclave/shared/dist/utils/urls";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// The dev tool overlay runs inside the customer's own app, which lives on a
// different localhost origin than the development-environment dashboard on
// :26700. It therefore has no browser secret and must reach this endpoint
// cross-origin (the dashboard's global middleware already allows CORS for all
// API routes). That's intentionally safe here: the only thing this endpoint
// ever reveals is whether the locally-running development environment already
// owns a given project id — never secrets, config, or any other project data.
// The real trust boundary is that the development environment only ever binds
// to loopback; the host check below is defense-in-depth against proxied hosts.

function requestHostIsLoopback(req: NextRequest): boolean {
  const host = req.headers.get("host");
  if (host == null) return false;
  return isLocalhost(`http://${host}`);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const isRemoteDevelopmentEnvironment = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT") === "true";
  if (!isRemoteDevelopmentEnvironment) {
    return NextResponse.json({ error: "This endpoint is only available in development environments." }, { status: 404 });
  }
  if (!requestHostIsLoopback(req)) {
    return NextResponse.json({ error: "This endpoint is only available on loopback addresses." }, { status: 403 });
  }

  const projectId = req.nextUrl.searchParams.get("project_id");
  if (projectId == null || projectId.length === 0) {
    return NextResponse.json({ error: "Missing project_id query parameter." }, { status: 400 });
  }

  const { getRemoteDevelopmentEnvironmentProjectConfigPaths } = await import("@/lib/remote-development-environment/manager");
  const projectAvailable = getRemoteDevelopmentEnvironmentProjectConfigPaths().has(projectId);
  return NextResponse.json({ running: true, project_available: projectAvailable });
}
