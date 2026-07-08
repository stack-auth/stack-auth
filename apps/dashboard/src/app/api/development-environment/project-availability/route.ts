import { getPublicEnvVar } from "@/lib/env";
import { isLocalhost } from "@hexclave/shared/dist/utils/urls";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// The dev tool overlay runs inside the customer's own app, which lives on a
// different localhost origin than the development-environment dashboard on
// :26700. It therefore has no browser secret and must reach this endpoint
// cross-origin. That's intentionally safe here: the only thing this endpoint
// ever reveals is whether the locally-running development environment already
// owns a given project id — never secrets, config, or any other project data —
// so any localhost page is allowed to probe its own development environment.

function requestHostIsLoopback(req: NextRequest): boolean {
  const host = req.headers.get("host");
  if (host == null) return false;
  return isLocalhost(`http://${host}`);
}

// Only reflect localhost origins. The dev tool always runs on localhost, and
// restricting the allowed origin keeps non-local pages from probing which
// projects a developer is running locally.
function corsHeadersForRequest(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin");
  if (origin != null && isLocalhost(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
    };
  }
  return {};
}

function jsonWithCors(req: NextRequest, body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: corsHeadersForRequest(req) });
}

export function OPTIONS(req: NextRequest): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...corsHeadersForRequest(req),
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const isRemoteDevelopmentEnvironment = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT") === "true";
  if (!isRemoteDevelopmentEnvironment) {
    return jsonWithCors(req, { error: "This endpoint is only available in development environments." }, 404);
  }
  if (!requestHostIsLoopback(req)) {
    return jsonWithCors(req, { error: "This endpoint is only available on loopback addresses." }, 403);
  }

  const projectId = req.nextUrl.searchParams.get("project_id");
  if (projectId == null || projectId.length === 0) {
    return jsonWithCors(req, { error: "Missing project_id query parameter." }, 400);
  }

  const { getRemoteDevelopmentEnvironmentProjectConfigPaths } = await import("@/lib/remote-development-environment/manager");
  const projectAvailable = getRemoteDevelopmentEnvironmentProjectConfigPaths().has(projectId);
  return jsonWithCors(req, { running: true, project_available: projectAvailable }, 200);
}
