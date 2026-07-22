import { getPublicEnvVar } from "@/lib/env";
import { isLocalhost } from "@hexclave/shared/dist/utils/urls";
import { NextRequest, NextResponse } from "next/server";

// The dev tool overlay runs inside the customer's own app, which lives on a
// different localhost origin than the development-environment dashboard on
// :26700. It therefore has no browser secret and must reach this endpoint
// cross-origin. All this endpoint ever reveals is whether the locally-running
// development environment already owns a given project id — never secrets,
// config, or any other project data. Even so, the dashboard's global CORS
// middleware sets `Access-Control-Allow-Origin: *` on every /api/ route, which
// would otherwise let any website a developer visits read that ownership
// boolean off their machine. We therefore gate on both:
//   - the request Host being loopback (defense-in-depth against proxied hosts;
//     the development environment only ever binds to loopback anyway), and
//   - the request Origin being absent or itself a localhost origin, so a
//     non-localhost page cannot read the response cross-origin.

function requestHostIsLoopback(req: NextRequest): boolean {
  const host = req.headers.get("host");
  if (host == null) return false;
  return isLocalhost(`http://${host}`);
}

// A browser attaches an `Origin` header to every cross-origin (and most
// same-origin) fetches. A missing Origin means the caller is not a browser
// cross-origin request (e.g. a same-origin/non-browser client), which is fine.
// If it is present, it must be a localhost origin — otherwise some remote site
// is trying to read our loopback-only ownership boolean.
function requestOriginIsAllowed(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (origin == null) return true;
  return isLocalhost(origin);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const isRemoteDevelopmentEnvironment = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT") === "true";
  if (!isRemoteDevelopmentEnvironment) {
    return NextResponse.json({ error: "This endpoint is only available in development environments." }, { status: 404 });
  }
  if (!requestHostIsLoopback(req)) {
    return NextResponse.json({ error: "This endpoint is only available on loopback addresses." }, { status: 403 });
  }
  if (!requestOriginIsAllowed(req)) {
    return NextResponse.json({ error: "This endpoint is only available to localhost origins." }, { status: 403 });
  }

  const projectId = req.nextUrl.searchParams.get("project_id");
  if (projectId == null || projectId.length === 0) {
    return NextResponse.json({ error: "Missing project_id query parameter." }, { status: 400 });
  }

  const { getRemoteDevelopmentEnvironmentProjectConfigPaths } = await import("@/lib/remote-development-environment/manager");
  const projectAvailable = getRemoteDevelopmentEnvironmentProjectConfigPaths().has(projectId);
  return NextResponse.json({ running: true, project_available: projectAvailable });
}
