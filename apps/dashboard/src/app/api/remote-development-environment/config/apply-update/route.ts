import { NextRequest, NextResponse } from "next/server";
import { applyRemoteDevelopmentEnvironmentConfigUpdate } from "@/lib/remote-development-environment/manager";
import { assertRemoteDevelopmentEnvironmentRequest } from "@/lib/remote-development-environment/security";
import { isValidConfig } from "@stackframe/stack-shared/dist/config/format";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const securityResponse = assertRemoteDevelopmentEnvironmentRequest(req);
  if (securityResponse != null) return securityResponse;

  const body = await req.json() as {
    session_id?: unknown,
    config?: unknown,
  };
  if (typeof body.session_id !== "string" || body.config == null || typeof body.config !== "object" || Array.isArray(body.config)) {
    return NextResponse.json({ error: "session_id and config object are required." }, { status: 400 });
  }
  if (!isValidConfig(body.config)) {
    return NextResponse.json({ error: "config must be a valid Stack Auth config object." }, { status: 400 });
  }

  await applyRemoteDevelopmentEnvironmentConfigUpdate({
    sessionId: body.session_id,
    config: body.config,
  });
  return NextResponse.json({ ok: true });
}
