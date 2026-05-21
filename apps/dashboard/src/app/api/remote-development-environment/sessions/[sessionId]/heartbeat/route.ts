import { NextRequest, NextResponse } from "next/server";
import { heartbeatRemoteDevelopmentEnvironmentSession } from "@/lib/remote-development-environment/manager";
import { assertRemoteDevelopmentEnvironmentRequest } from "@/lib/remote-development-environment/security";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const securityResponse = assertRemoteDevelopmentEnvironmentRequest(req);
  if (securityResponse != null) return securityResponse;

  const { sessionId } = await params;
  if (!heartbeatRemoteDevelopmentEnvironmentSession(sessionId)) {
    return NextResponse.json({ error: "Unknown remote development environment session." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
